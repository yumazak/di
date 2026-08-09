package main

// フロントの静的ファイル。`scripts/pack-web.mjs` が dist/web を gzip して
// webdist/ に置き、それをバイナリへ埋め込む。
//
// gzip のまま埋めて gzip のまま返すので、バイナリも転送量も小さくなる。
// gzip を受け付けないクライアントにはその場で展開して返す。

import (
	"bytes"
	"compress/gzip"
	"embed"
	"io"
	"net/http"
	"path"
	"strings"
	"time"
)

//go:embed webdist
var webdist embed.FS

var mimeByExt = map[string]string{
	".html":  "text/html; charset=utf-8",
	".js":    "text/javascript; charset=utf-8",
	".css":   "text/css; charset=utf-8",
	".json":  "application/json; charset=utf-8",
	".wasm":  "application/wasm",
	".svg":   "image/svg+xml",
	".ico":   "image/x-icon",
	".woff2": "font/woff2",
}

func nowRFC3339() string {
	return time.Now().UTC().Format(time.RFC3339)
}

// URL のパスを webdist 内の相対パスに直す。`..` は落とす。
func toAssetPath(pathname string) string {
	cleaned := path.Clean("/" + strings.TrimPrefix(pathname, "/"))
	if cleaned == "/" {
		return "index.html"
	}
	return strings.TrimPrefix(cleaned, "/")
}

func handleStatic(w http.ResponseWriter, r *http.Request) {
	relPath := toAssetPath(r.URL.Path)

	body, err := webdist.ReadFile("webdist/" + relPath + ".gz")
	if err != nil {
		w.Header().Set("content-type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusNotFound)
		_, _ = io.WriteString(w, "404\n\n開発中は Vite (http://localhost:5173) を開いてください。\n")
		return
	}

	if mime, ok := mimeByExt[path.Ext(relPath)]; ok {
		w.Header().Set("content-type", mime)
	} else {
		w.Header().Set("content-type", "application/octet-stream")
	}

	if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		w.Header().Set("content-encoding", "gzip")
		w.Header().Set("vary", "Accept-Encoding")
		_, _ = w.Write(body)
		return
	}

	reader, err := gzip.NewReader(bytes.NewReader(body))
	if err != nil {
		http.Error(w, "asset decode failed", http.StatusInternalServerError)
		return
	}
	defer reader.Close()
	_, _ = io.Copy(w, reader)
}
