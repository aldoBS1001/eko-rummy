package main

import (
	"io"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestServesEmbeddedGame(t *testing.T) {
	srv := httptest.NewServer(handler())
	defer srv.Close()
	cases := map[string]string{"/": "text/html", "/app.js": "text/javascript", "/app.css": "text/css", "/manifest.webmanifest": "application/manifest+json", "/sw.js": "text/javascript", "/img/guia.webp": "image/webp", "/icons/icon-192.png": "image/png", "/health-eko": ""}
	for path, ct := range cases {
		resp, err := srv.Client().Get(srv.URL + path)
		if err != nil || resp.StatusCode != 200 {
			t.Fatalf("%s: %v %v", path, err, resp)
		}
		if ct != "" && !strings.HasPrefix(resp.Header.Get("Content-Type"), ct) {
			t.Errorf("%s: content-type %q", path, resp.Header.Get("Content-Type"))
		}
		b, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if len(b) == 0 {
			t.Errorf("%s vacío", path)
		}
	}
}
