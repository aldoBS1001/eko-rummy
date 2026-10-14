#!/bin/bash
# EKO RUMMY · instalación automática en Oracle Cloud "Always Free" (Ubuntu 22.04/24.04, ARM o AMD).
# Se pega completo en: Crear instancia › Mostrar opciones avanzadas › Gestión › "Pegar script cloud-init".
# Solo hay que llenar las líneas de abajo. Tarda ~10 minutos después de que la VM aparece "En ejecución".

GITHUB_TOKEN="PEGA_AQUI_EL_TOKEN_DE_GITHUB"   # token de solo lectura del repositorio aldoBS1001/eko-rummy
ADMIN_USER="aldo"                             # tu nombre de usuario en el juego (tendrá el panel de administración)
DOMAIN=""                                     # opcional: p. ej. juego.ekokiin.com (vacío = IP.sslip.io automático)

# ----------------------------------------------------------------- no editar debajo
set -euxo pipefail
exec > >(tee -a /var/log/eko-rummy-install.log) 2>&1
export DEBIAN_FRONTEND=noninteractive
REPO="github.com/aldoBS1001/eko-rummy.git"
DIR=/opt/eko-rummy

# 1) memoria de intercambio (la VM AMD gratuita solo tiene 1 GB)
if [ ! -f /swapfile ]; then fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab; fi

# 2) paquetes
apt-get update -y
apt-get install -y docker.io git curl openssl iptables-persistent || apt-get install -y docker.io git curl openssl
apt-get install -y docker-compose-v2 || apt-get install -y docker-compose-plugin || true
systemctl enable --now docker

# 3) firewall interno de la imagen de Oracle: abrir 80 y 443
for p in 80 443; do
  iptables -C INPUT -p tcp --dport "$p" -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p tcp -m state --state NEW --dport "$p" -j ACCEPT
done
netfilter-persistent save || (mkdir -p /etc/iptables && iptables-save > /etc/iptables/rules.v4) || true

# 4) código
if [ ! -d "$DIR/.git" ]; then git clone "https://x-access-token:${GITHUB_TOKEN}@${REPO}" "$DIR"; fi
chmod 700 "$DIR"
cd "$DIR"

# 5) dominio con HTTPS automático
IP=$(curl -fsS https://checkip.amazonaws.com || curl -fsS https://api.ipify.org)
IP=$(echo "$IP" | tr -d '[:space:]')
[ -n "$DOMAIN" ] || DOMAIN="${IP//./-}.sslip.io"

# 6) configuración (.env): se crea una sola vez y se conserva en actualizaciones
if [ ! -f .env ]; then
  sed -e "s|^DOMAIN=.*|DOMAIN=${DOMAIN}|" \
      -e "s|^PUBLIC_URL=.*|PUBLIC_URL=https://${DOMAIN}|" \
      -e "s|^AUTH_SECRET=.*|AUTH_SECRET=$(openssl rand -hex 32)|" \
      -e "s|^ADMIN_USERS=.*|ADMIN_USERS=${ADMIN_USER}|" .env.example > .env
  chmod 600 .env
fi
mkdir -p backups

# 7) arrancar: app + HTTPS con Caddy + respaldos cada 6 h
docker compose up -d --build

# 8) actualización automática: cada 10 min revisa GitHub y reconstruye si hay cambios
cat > /usr/local/bin/eko-rummy-update <<'UPD'
#!/bin/bash
set -e
cd /opt/eko-rummy
git fetch -q origin
if [ "$(git rev-parse HEAD)" != "$(git rev-parse '@{u}')" ]; then
  git reset -q --hard '@{u}'
  docker compose up -d --build
  docker image prune -f >/dev/null
  echo "$(date -Is) actualizado a $(git rev-parse --short HEAD)" >> /var/log/eko-rummy-update.log
fi
UPD
chmod 755 /usr/local/bin/eko-rummy-update
cat > /etc/systemd/system/eko-rummy-update.service <<'UNIT'
[Unit]
Description=Actualiza EKO RUMMY desde GitHub
After=network-online.target docker.service
[Service]
Type=oneshot
ExecStart=/usr/local/bin/eko-rummy-update
UNIT
cat > /etc/systemd/system/eko-rummy-update.timer <<'UNIT'
[Unit]
Description=Revisa actualizaciones de EKO RUMMY cada 10 minutos
[Timer]
OnBootSec=3min
OnUnitActiveSec=10min
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now eko-rummy-update.timer

echo "https://${DOMAIN}" > /root/EKO-RUMMY-URL.txt
echo "EKO RUMMY listo en https://${DOMAIN}"
