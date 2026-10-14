#!/usr/bin/env sh
# Compila EKO-RUMMY.apk sin el SDK de Android (Python 3 + JDK para jarsigner).
# Requiere `npm run build` previo. La llave de firma debe ser SIEMPRE la misma para poder actualizar la app.
set -e
cd "$(dirname "$0")"
KS=${KEYSTORE:-eko-rummy-release.keystore}
PASS=${KEYSTORE_PASS:-$(cat keystore-password.txt)}
cp ../../apps/web/public/icons/icon-192.png icon.png
python3 build_apk.py ../../build/eko-rummy-standalone.html icon.png "$KS" ekorummy "$PASS" EKO-RUMMY.apk
python3 verify_apk.py EKO-RUMMY.apk >/dev/null && echo "Verificación de formato: OK"
