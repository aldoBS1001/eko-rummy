#!/usr/bin/env sh
# Compila "EKO RUMMY Instalador.exe" (Windows x64) con el juego embebido.
# Requiere Go 1.22+ y haber ejecutado antes `npm run build` (opcional: EKO_SERVER_URL=https://tu-dominio).
set -e
cd "$(dirname "$0")"
rm -rf launcher/web && cp -r ../../apps/web/dist launcher/web && rm -f launcher/web/admin.*
cp eko-rummy.ico launcher/eko-rummy.ico
go run ./winres eko-rummy.ico app.manifest launcher/rsrc_windows_amd64.syso
go test ./launcher
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags "-H windowsgui -s -w" -o "EKO RUMMY Instalador.exe" ./launcher
echo "Listo: $(pwd)/EKO RUMMY Instalador.exe"
