//go:build !windows

// Fuera de Windows: sirve el juego en http://127.0.0.1:47831 (útil para pruebas).
package main

import (
	"fmt"
	"net/http"
)

func main() {
	fmt.Println("EKO RUMMY en http://127.0.0.1:47831/")
	_ = http.ListenAndServe("127.0.0.1:47831", handler())
}
