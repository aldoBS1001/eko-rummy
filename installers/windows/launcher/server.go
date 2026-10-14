package main

import (
	"embed"
	"io/fs"
	"mime"
	"net/http"
)

//go:embed web
var webFiles embed.FS

func handler() http.Handler {
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")
	_ = mime.AddExtensionType(".webp", "image/webp")
	_ = mime.AddExtensionType(".js", "text/javascript; charset=utf-8")
	sub, _ := fs.Sub(webFiles, "web")
	files := http.FileServer(http.FS(sub))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-cache")
		if r.URL.Path == "/health-eko" {
			w.Write([]byte("ok"))
			return
		}
		files.ServeHTTP(w, r)
	})
}

