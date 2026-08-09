package main

// git を叩いて unified patch を作る層。
//
// 見せるのは「コミットしていない変更」を 2 本に分けたもの。
//   - staged:   `git diff --cached`（index vs HEAD）
//   - unstaged: `git diff`（worktree vs index）
//               + 未追跡ファイルを `git diff --no-index /dev/null <file>` で合成

import (
	"bytes"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

const (
	// untracked ファイルをそのまま patch に載せる上限。これを超えたら skipped 扱い。
	maxUntrackedBytes = 1024 * 1024
	binarySniffBytes  = 8192
)

// ユーザーの git 設定に引きずられると patch のヘッダ形式が変わってパーサが壊れるので、
// 差分の形に影響する設定はすべて明示的に打ち消す。
var gitConfigOverrides = []string{
	"-c", "core.quotepath=false",
	"-c", "diff.noprefix=false",
	"-c", "diff.mnemonicPrefix=false",
	"-c", "diff.external=",
	"-c", "diff.renames=true",
}

var diffFlags = []string{"--no-color", "--no-ext-diff", "--no-textconv", "--find-renames"}

// SkippedFile は patch に載せられなかった未追跡ファイル。
type SkippedFile struct {
	Path   string `json:"path"`
	Reason string `json:"reason"` // "binary" | "too-large"
}

// DiffPayload は `GET /api/diff` のレスポンス。
//
// ステージ済みと未ステージを分けて返す。VS Code と同じく、どちらに何が入っているかが
// 見えないとステージ操作の結果が分からないため。
type DiffPayload struct {
	RepoRoot string  `json:"repoRoot"`
	RepoName string  `json:"repoName"`
	Branch   *string `json:"branch"`
	Head     *string `json:"head"`
	// Staged は `git diff --cached`（index vs HEAD）。
	Staged string `json:"staged"`
	// Unstaged は `git diff`（worktree vs index）に未追跡ファイルを足したもの。
	Unstaged    string        `json:"unstaged"`
	Hash        string        `json:"hash"`
	Skipped     []SkippedFile `json:"skipped"`
	GeneratedAt string        `json:"generatedAt"`
}

// FileStatus はファイラのツリーに出す変更マーク。
type FileStatus struct {
	Path   string `json:"path"`
	Status string `json:"status"` // added | deleted | modified | renamed | untracked
}

// FileListPayload は `GET /api/files` のレスポンス。
type FileListPayload struct {
	Paths    []string     `json:"paths"`
	Statuses []FileStatus `json:"statuses"`
}

// FilePayload は `GET /api/file?path=` のレスポンス。
type FilePayload struct {
	Path        string `json:"path"`
	Contents    string `json:"contents"`
	Unavailable string `json:"unavailable,omitempty"` // "binary" | "too-large"
	Bytes       int64  `json:"bytes"`
}

// ErrNotARepository は指定パスが git 管理下でないとき。
var ErrNotARepository = errors.New("git リポジトリではありません")

// ErrInvalidPath はリポジトリの外を指すパスを渡されたとき。
var ErrInvalidPath = errors.New("リポジトリの外側のパスです")

// Repo は 1 つのリポジトリに対する操作をまとめる。
type Repo struct {
	Root string

	// 未追跡ファイルの patch キャッシュ。1 ファイルにつき git を 1 プロセス起動するのが
	// collectDiff のコストのほぼ全部なので、mtime と size が変わっていないものは
	// 前回の結果を使い回す。
	mu    sync.Mutex
	cache map[string]cachedPatch
}

type cachedPatch struct {
	modUnixNano int64
	size        int64
	patch       string
}

// OpenRepo は与えられたパスを含むリポジトリのルートを解決する。
func OpenRepo(path string) (*Repo, error) {
	out, err := exec.Command("git", "-C", path, "rev-parse", "--show-toplevel").Output()
	if err != nil {
		return nil, fmt.Errorf("%s は %w", path, ErrNotARepository)
	}
	return &Repo{Root: strings.TrimSpace(string(out)), cache: map[string]cachedPatch{}}, nil
}

// git を実行する。allowExit に含まれる終了コードは成功として扱う。
func (r *Repo) git(allowExit []int, args ...string) (string, int, error) {
	full := append([]string{"-C", r.Root}, gitConfigOverrides...)
	full = append(full, args...)

	cmd := exec.Command("git", full...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	if err == nil {
		return stdout.String(), 0, nil
	}

	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		code := exitErr.ExitCode()
		for _, allowed := range allowExit {
			if code == allowed {
				return stdout.String(), code, nil
			}
		}
		return "", code, fmt.Errorf("git %s に失敗しました: %s",
			strings.Join(args, " "), strings.TrimSpace(stderr.String()))
	}
	return "", -1, fmt.Errorf("git %s に失敗しました: %w", strings.Join(args, " "), err)
}

func (r *Repo) hasCommits() bool {
	_, code, err := r.git([]int{1}, "rev-parse", "--verify", "--quiet", "HEAD")
	return err == nil && code == 0
}

// ブランチ名。`rev-parse --abbrev-ref` はコミットが 1 つも無いと失敗するので、
// unborn branch でも名前が取れる `symbolic-ref` を使う。detached HEAD では nil。
func (r *Repo) branch() *string {
	out, code, err := r.git([]int{1, 128}, "symbolic-ref", "--short", "-q", "HEAD")
	if err != nil || code != 0 {
		return nil
	}
	name := strings.TrimSpace(out)
	if name == "" {
		return nil
	}
	return &name
}

func (r *Repo) head() *string {
	out, code, err := r.git([]int{128}, "rev-parse", "--short", "HEAD")
	if err != nil || code != 0 {
		return nil
	}
	sha := strings.TrimSpace(out)
	if sha == "" {
		return nil
	}
	return &sha
}

// 先頭を覗いて NUL があればバイナリとみなす。git 自身と同じ雑な判定。
func looksBinary(absPath string) (bool, error) {
	file, err := os.Open(absPath)
	if err != nil {
		return false, err
	}
	defer file.Close()

	buf := make([]byte, binarySniffBytes)
	n, err := file.Read(buf)
	if err != nil && n == 0 {
		return false, nil
	}
	return bytes.IndexByte(buf[:n], 0) >= 0, nil
}

func splitNUL(s string) []string {
	out := []string{}
	for _, part := range strings.Split(s, "\x00") {
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func (r *Repo) listUntracked() ([]string, error) {
	out, _, err := r.git(nil, "ls-files", "--others", "--exclude-standard", "-z")
	if err != nil {
		return nil, err
	}
	return splitNUL(out), nil
}

// untracked ファイルを「新規ファイルの diff」として patch 化する。
// `--no-index` は差分があると exit 1 を返すので、それは成功扱いにする。
func (r *Repo) diffUntracked(paths []string) (string, []SkippedFile, error) {
	var patch strings.Builder
	skipped := []SkippedFile{}
	next := make(map[string]cachedPatch, len(paths))

	r.mu.Lock()
	prev := r.cache
	r.mu.Unlock()

	for _, path := range paths {
		abs := filepath.Join(r.Root, path)
		info, err := os.Stat(abs)
		if err != nil {
			continue // 列挙してから読むまでの間に消えた
		}

		if cached, ok := prev[path]; ok &&
			cached.modUnixNano == info.ModTime().UnixNano() && cached.size == info.Size() {
			next[path] = cached
			patch.WriteString(cached.patch)
			continue
		}

		if info.Size() > maxUntrackedBytes {
			skipped = append(skipped, SkippedFile{Path: path, Reason: "too-large"})
			continue
		}
		binary, err := looksBinary(abs)
		if err != nil {
			continue
		}
		if binary {
			skipped = append(skipped, SkippedFile{Path: path, Reason: "binary"})
			continue
		}

		args := append([]string{"diff"}, diffFlags...)
		args = append(args, "--no-index", "--", os.DevNull, path)
		out, _, err := r.git([]int{1}, args...)
		if err != nil {
			return "", nil, err
		}

		next[path] = cachedPatch{
			modUnixNano: info.ModTime().UnixNano(),
			size:        info.Size(),
			patch:       out,
		}
		patch.WriteString(out)
	}

	r.mu.Lock()
	r.cache = next // 毎回作り直すことで、消えたファイルのエントリも自然に落ちる
	r.mu.Unlock()

	return patch.String(), skipped, nil
}

// Discard は未ステージの変更を捨てる。**取り消せない。**
//
// 追跡済みのファイルは index の内容へ戻し（`git restore --worktree`）、未追跡の
// ファイルは削除する。git には未追跡ファイルを「戻す」概念が無いため。
//
// ステージ済みの内容には触らない。add 済みのファイルをさらに編集していた場合、
// 捨てられるのは add 後の編集分だけになる。
func (r *Repo) Discard(paths []string) error {
	if len(paths) == 0 {
		return nil
	}

	safe := make([]string, 0, len(paths))
	for _, path := range paths {
		clean, err := safeRelPath(path)
		if err != nil {
			return fmt.Errorf("%w: %s", ErrInvalidPath, path)
		}
		safe = append(safe, clean)
	}

	// index に載っているものが「追跡済み」。載っていないものは未追跡なので消すしかない
	args := append([]string{"ls-files", "-z", "--"}, safe...)
	out, _, err := r.git(nil, args...)
	if err != nil {
		return err
	}
	tracked := map[string]bool{}
	for _, path := range splitNUL(out) {
		tracked[path] = true
	}

	restore := []string{}
	for _, path := range safe {
		if tracked[path] {
			restore = append(restore, path)
			continue
		}
		if err := os.Remove(filepath.Join(r.Root, filepath.FromSlash(path))); err != nil &&
			!errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("%s を削除できませんでした: %w", path, err)
		}
	}

	if len(restore) > 0 {
		args := append([]string{"restore", "--worktree", "--"}, restore...)
		if _, _, err := r.git(nil, args...); err != nil {
			return err
		}
	}
	return nil
}

// CollectDiff は現在のリポジトリの「コミットしていない差分」をまとめて返す。
func (r *Repo) CollectDiff() (*DiffPayload, error) {
	// コミットが無くても `--cached` は空ツリーとの比較になるのでそのまま使える
	stagedArgs := append([]string{"diff"}, diffFlags...)
	stagedArgs = append(stagedArgs, "--cached")
	staged, _, err := r.git(nil, stagedArgs...)
	if err != nil {
		return nil, err
	}

	unstagedTracked, _, err := r.git(nil, append([]string{"diff"}, diffFlags...)...)
	if err != nil {
		return nil, err
	}

	// 未追跡ファイルは index に入っていないので未ステージ側
	untrackedPaths, err := r.listUntracked()
	if err != nil {
		return nil, err
	}
	untracked, skipped, err := r.diffUntracked(untrackedPaths)
	if err != nil {
		return nil, err
	}

	unstaged := unstagedTracked + untracked
	sum := sha1.Sum([]byte(staged + "\x00" + unstaged))

	return &DiffPayload{
		RepoRoot:    r.Root,
		RepoName:    filepath.Base(r.Root),
		Branch:      r.branch(),
		Head:        r.head(),
		Staged:      staged,
		Unstaged:    unstaged,
		Hash:        hex.EncodeToString(sum[:])[:16],
		Skipped:     skipped,
		GeneratedAt: nowRFC3339(),
	}, nil
}

// safeRelPath はブラウザから来たパスを検証してリポジトリ相対の形に直す。
// 削除済みファイルもステージ対象になるので、存在チェックはしない。
//
// `filepath.Clean` に任せると `../../etc/passwd` が `etc/passwd` に化けて
// 「リポジトリ内の存在しないパス」になってしまうので、`..` と絶対パスは弾く。
func safeRelPath(relPath string) (string, error) {
	slashed := filepath.ToSlash(relPath)
	if slashed == "" || strings.HasPrefix(slashed, "/") || filepath.IsAbs(relPath) {
		return "", ErrInvalidPath
	}
	for _, segment := range strings.Split(slashed, "/") {
		if segment == ".." {
			return "", ErrInvalidPath
		}
	}

	cleaned := path.Clean(slashed)
	if cleaned == "." {
		return "", ErrInvalidPath
	}
	return cleaned, nil
}

// Stage は指定したパスをステージに入れる／から出す。
//
// 解除は `git reset` を使う。`git restore --staged` はコミットが 1 つも無いと
// HEAD を解決できず、`git rm --cached` は「index の内容がファイルとも HEAD とも違う」
// ケース（add した後にファイルを消した等）を拒否する。`git reset` はどちらの状況でも
// worktree を触らずに index だけ戻せる。
func (r *Repo) Stage(paths []string, staged bool) error {
	if len(paths) == 0 {
		return nil
	}

	safe := make([]string, 0, len(paths))
	for _, path := range paths {
		clean, err := safeRelPath(path)
		if err != nil {
			return fmt.Errorf("%w: %s", ErrInvalidPath, path)
		}
		safe = append(safe, clean)
	}

	var args []string
	if staged {
		args = append([]string{"add", "--"}, safe...)
	} else {
		args = append([]string{"reset", "--quiet", "--"}, safe...)
	}

	_, _, err := r.git(nil, args...)
	return err
}

var statusMap = map[byte]string{
	'A': "added",
	'D': "deleted",
	'M': "modified",
	'R': "renamed",
	'C': "modified",
	'T': "modified",
	'U': "modified",
}

// `git status --porcelain -z --untracked-files=all` を 1 回だけ回す。
// --untracked-files=all を付けないと未追跡ディレクトリが `foo/` 1 件にまとめられ、
// ツリーのファイル行に印が付かない。
func (r *Repo) runStatus() (string, []FileStatus, error) {
	raw, _, err := r.git(nil, "status", "--porcelain", "-z", "--untracked-files=all")
	if err != nil {
		return "", nil, err
	}

	statuses := []FileStatus{}
	// -z は NUL 区切り。rename のときだけ「新パス NUL 旧パス」の 2 レコードになる
	records := strings.Split(raw, "\x00")
	for i := 0; i < len(records); i++ {
		record := records[i]
		if len(record) < 4 {
			continue
		}
		index, worktree, path := record[0], record[1], record[3:]

		if index == '?' && worktree == '?' {
			statuses = append(statuses, FileStatus{Path: path, Status: "untracked"})
			continue
		}
		if index == 'R' || index == 'C' {
			i++ // 旧パスのレコードを読み飛ばす
		}

		status, ok := statusMap[index]
		if !ok {
			status, ok = statusMap[worktree]
		}
		if ok {
			statuses = append(statuses, FileStatus{Path: path, Status: status})
		}
	}
	return raw, statuses, nil
}

// Signature は「差分が変わったかもしれない」ことを安く判定するための署名。
//
// CollectDiff は未追跡ファイル 1 件につき git を 1 プロセス起動するので、ポーリングの
// たびに呼ぶと重い。署名は git 1 プロセスと変更のあったファイルの stat だけで済む。
//
// `git status` の出力だけでは「すでに変更済みのファイルをもう一度編集した」場合に
// 変化しないので、対象パスの mtime と size も混ぜる。
func (r *Repo) Signature() (string, error) {
	raw, statuses, err := r.runStatus()
	if err != nil {
		return "", err
	}

	var buf strings.Builder
	if head := r.head(); head != nil {
		buf.WriteString(*head)
	}
	buf.WriteByte(0)
	buf.WriteString(raw)

	for _, status := range statuses {
		buf.WriteByte(0)
		buf.WriteString(status.Path)
		if info, err := os.Stat(filepath.Join(r.Root, status.Path)); err == nil {
			fmt.Fprintf(&buf, ":%d:%d", info.ModTime().UnixNano(), info.Size())
		} else {
			buf.WriteString(":-")
		}
	}

	sum := sha1.Sum([]byte(buf.String()))
	return hex.EncodeToString(sum[:])[:16], nil
}

// ListFiles はファイラに出すパス一覧。tracked + untracked で、.gitignore は尊重する。
func (r *Repo) ListFiles() (*FileListPayload, error) {
	out, _, err := r.git(nil, "ls-files", "--cached", "--others", "--exclude-standard", "-z")
	if err != nil {
		return nil, err
	}
	_, statuses, err := r.runStatus()
	if err != nil {
		return nil, err
	}

	seen := map[string]bool{}
	paths := []string{}
	for _, path := range splitNUL(out) {
		if !seen[path] {
			seen[path] = true
			paths = append(paths, path)
		}
	}
	sort.Strings(paths)

	return &FileListPayload{Paths: paths, Statuses: statuses}, nil
}

// ReadFile はリポジトリ内のファイルを読む。
//
// パスはクライアント（＝ブラウザ）から来るので、正規化しただけでは足りない。
// シンボリックリンク経由でリポジトリ外へ抜けられないよう EvalSymlinks で確認する。
func (r *Repo) ReadFile(relPath string) (*FilePayload, error) {
	cleaned := filepath.Clean("/" + filepath.FromSlash(relPath))[1:]
	if cleaned == "" || cleaned == "." {
		return nil, ErrInvalidPath
	}

	root, err := filepath.EvalSymlinks(r.Root)
	if err != nil {
		return nil, ErrInvalidPath
	}
	target := filepath.Join(root, cleaned)
	if !strings.HasPrefix(target, root+string(filepath.Separator)) {
		return nil, ErrInvalidPath
	}

	real, err := filepath.EvalSymlinks(target)
	if err != nil || !strings.HasPrefix(real, root+string(filepath.Separator)) {
		return nil, ErrInvalidPath
	}

	info, err := os.Stat(real)
	if err != nil {
		return nil, fs.ErrNotExist
	}
	if !info.Mode().IsRegular() {
		return nil, ErrInvalidPath
	}

	slashPath := filepath.ToSlash(cleaned)
	if info.Size() > maxUntrackedBytes {
		return &FilePayload{Path: slashPath, Unavailable: "too-large", Bytes: info.Size()}, nil
	}
	binary, err := looksBinary(real)
	if err != nil {
		return nil, err
	}
	if binary {
		return &FilePayload{Path: slashPath, Unavailable: "binary", Bytes: info.Size()}, nil
	}

	body, err := os.ReadFile(real)
	if err != nil {
		return nil, err
	}
	return &FilePayload{Path: slashPath, Contents: string(body), Bytes: info.Size()}, nil
}
