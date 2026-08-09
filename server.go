package main

// ローカル HTTP サーバ。
//
//   - GET /api/diff        現在の差分（JSON）
//   - GET /api/files       ファイラ用のパス一覧
//   - GET /api/file?path=  ファイルの中身
//   - POST /api/stage      ステージへ入れる／から出す（index を書き換える）
//   - POST /api/discard    未ステージの変更を捨てる（**取り消せない**）
//   - GET /api/events      差分が変わったら通知する SSE
//   - それ以外             バイナリに埋め込んだフロントを配信
//
// 変更検知は git のポーリング。fs の監視は .git の中身・エディタの一時ファイル・
// 無視ファイルの扱いで嘘をつきやすく、結局 git を叩き直すことになるので、
// 最初から git の出力だけを見ている。

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"sync"
	"time"
)

const (
	pollInterval = 700 * time.Millisecond
	heartbeat    = 25 * time.Second
)

// Server は 1 リポジトリぶんの HTTP サーバ。
type Server struct {
	repo *Repo
	http *http.Server
	URL  string

	mu            sync.Mutex
	clients       map[chan string]struct{}
	lastHash      string
	lastSignature string
	stopPoll      chan struct{}
}

// AddressInUseError は --port で指定したポートが埋まっていた場合。
// 既定の自動選択では起きない。
type AddressInUseError struct {
	Host string
	Port int
}

func (e *AddressInUseError) Error() string {
	return fmt.Sprintf(
		"%s:%d は既に使われています。\n       --port で別のポートを指定するか、--port を省略して自動選択にしてください。",
		e.Host, e.Port)
}

// StartServer はサーバを起動し、実際に割り当てられた URL を持つ Server を返す。
func StartServer(repo *Repo, host string, port int) (*Server, error) {
	listener, err := net.Listen("tcp", fmt.Sprintf("%s:%d", host, port))
	if err != nil {
		var opErr *net.OpError
		if errors.As(err, &opErr) && isAddrInUse(opErr) {
			return nil, &AddressInUseError{Host: host, Port: port}
		}
		return nil, err
	}

	srv := &Server{
		repo:    repo,
		clients: map[chan string]struct{}{},
		URL:     fmt.Sprintf("http://%s", listener.Addr().String()),
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/diff", srv.handleDiff)
	mux.HandleFunc("/api/files", srv.handleFiles)
	mux.HandleFunc("/api/file", srv.handleFile)
	mux.HandleFunc("/api/stage", srv.handleStage)
	mux.HandleFunc("/api/discard", srv.handleDiscard)
	mux.HandleFunc("/api/events", srv.handleEvents)
	mux.HandleFunc("/", handleStatic)

	srv.http = &http.Server{Handler: mux}
	go func() {
		// 起動後のエラーでプロセスごと落とさない
		if err := srv.http.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("[di] サーバでエラーが発生しました: %v", err)
		}
	}()

	return srv, nil
}

// Close はサーバと購読者を畳む。
func (s *Server) Close() error {
	s.mu.Lock()
	for ch := range s.clients {
		close(ch)
		delete(s.clients, ch)
	}
	s.stopPollingLocked()
	s.mu.Unlock()
	return s.http.Close()
}

func sendJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("content-type", "application/json; charset=utf-8")
	w.Header().Set("cache-control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func sendError(w http.ResponseWriter, status int, err error) {
	sendJSON(w, status, map[string]string{"error": err.Error()})
}

func (s *Server) handleDiff(w http.ResponseWriter, _ *http.Request) {
	payload, err := s.repo.CollectDiff()
	if err != nil {
		sendError(w, http.StatusInternalServerError, err)
		return
	}
	s.mu.Lock()
	s.lastHash = payload.Hash
	s.mu.Unlock()
	sendJSON(w, http.StatusOK, payload)
}

func (s *Server) handleFiles(w http.ResponseWriter, _ *http.Request) {
	payload, err := s.repo.ListFiles()
	if err != nil {
		sendError(w, http.StatusInternalServerError, err)
		return
	}
	sendJSON(w, http.StatusOK, payload)
}

func (s *Server) handleFile(w http.ResponseWriter, r *http.Request) {
	target := r.URL.Query().Get("path")
	if target == "" {
		sendError(w, http.StatusBadRequest, errors.New("path が指定されていません"))
		return
	}

	payload, err := s.repo.ReadFile(target)
	if err != nil {
		status := http.StatusNotFound
		if errors.Is(err, ErrInvalidPath) {
			status = http.StatusBadRequest
			err = fmt.Errorf("%w: %s", ErrInvalidPath, target)
		}
		sendError(w, status, err)
		return
	}
	sendJSON(w, http.StatusOK, payload)
}

type stageRequest struct {
	Paths  []string `json:"paths"`
	Staged bool     `json:"staged"`
}

// handleStage はファイルをステージに入れる／から出す。
//
// di は本来読み取り専用のツールだが、ここだけリポジトリの index を書き換える。
// 到達できる相手は誰でも叩けるので、公開範囲は --host の指定で絞ること。
func (s *Server) handleStage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		sendError(w, http.StatusMethodNotAllowed, errors.New("POST のみ受け付けます"))
		return
	}

	var req stageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, fmt.Errorf("リクエストを解釈できません: %w", err))
		return
	}

	if err := s.repo.Stage(req.Paths, req.Staged); err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, ErrInvalidPath) {
			status = http.StatusBadRequest
		}
		sendError(w, status, err)
		return
	}

	s.respondWithDiff(w)
}

// respondWithDiff は書き込み系 API の応答。SSE を待たずに最新の差分を返す。
func (s *Server) respondWithDiff(w http.ResponseWriter) {
	payload, err := s.repo.CollectDiff()
	if err != nil {
		sendError(w, http.StatusInternalServerError, err)
		return
	}
	s.mu.Lock()
	s.lastHash = payload.Hash
	s.mu.Unlock()
	sendJSON(w, http.StatusOK, payload)
}

type discardRequest struct {
	Paths []string `json:"paths"`
}

// handleDiscard は未ステージの変更を捨てる。
//
// 作業内容が消えて戻せないので、UI 側で必ず確認を取ってから呼ぶこと。
func (s *Server) handleDiscard(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		sendError(w, http.StatusMethodNotAllowed, errors.New("POST のみ受け付けます"))
		return
	}

	var req discardRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		sendError(w, http.StatusBadRequest, fmt.Errorf("リクエストを解釈できません: %w", err))
		return
	}

	if err := s.repo.Discard(req.Paths); err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, ErrInvalidPath) {
			status = http.StatusBadRequest
		}
		sendError(w, status, err)
		return
	}

	log.Printf("[di] 破棄: %v", req.Paths)
	s.respondWithDiff(w)
}

func (s *Server) handleEvents(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("content-type", "text/event-stream; charset=utf-8")
	w.Header().Set("cache-control", "no-store")
	w.Header().Set("connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, ": connected\n\n")
	flusher.Flush()

	ch := make(chan string, 8)
	s.mu.Lock()
	s.clients[ch] = struct{}{}
	s.startPollingLocked()
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		if _, ok := s.clients[ch]; ok {
			delete(s.clients, ch)
		}
		s.stopPollingIfIdleLocked()
		s.mu.Unlock()
	}()

	ping := time.NewTicker(heartbeat)
	defer ping.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case frame, open := <-ch:
			if !open {
				return
			}
			fmt.Fprint(w, frame)
			flusher.Flush()
		case <-ping.C:
			fmt.Fprint(w, ": ping\n\n")
			flusher.Flush()
		}
	}
}

// SSE の購読者がいる間だけポーリングする。
func (s *Server) startPollingLocked() {
	if s.stopPoll != nil {
		return
	}
	stop := make(chan struct{})
	s.stopPoll = stop

	go func() {
		ticker := time.NewTicker(pollInterval)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				s.poll()
			}
		}
	}()
}

func (s *Server) stopPollingIfIdleLocked() {
	if len(s.clients) == 0 {
		s.stopPollingLocked()
	}
}

func (s *Server) stopPollingLocked() {
	if s.stopPoll == nil {
		return
	}
	close(s.stopPoll)
	s.stopPoll = nil
}

// 変更検知。まず安い署名だけ見て、動いていなければ patch は作らない。
// 署名が動いても patch が同じ（touch しただけ等）なら通知はしない。
func (s *Server) poll() {
	signature, err := s.repo.Signature()
	if err != nil {
		log.Printf("[di] 差分の取得に失敗しました: %v", err)
		return
	}

	s.mu.Lock()
	unchanged := signature == s.lastSignature
	s.lastSignature = signature
	s.mu.Unlock()
	if unchanged {
		return
	}

	payload, err := s.repo.CollectDiff()
	if err != nil {
		log.Printf("[di] 差分の取得に失敗しました: %v", err)
		return
	}

	s.mu.Lock()
	changed := s.lastHash != "" && payload.Hash != s.lastHash
	s.lastHash = payload.Hash
	if changed {
		frame := fmt.Sprintf("event: change\ndata: {\"hash\":%q}\n\n", payload.Hash)
		for ch := range s.clients {
			select {
			case ch <- frame:
			default: // 詰まっている購読者は落とさず読み飛ばす
			}
		}
	}
	s.mu.Unlock()
}
