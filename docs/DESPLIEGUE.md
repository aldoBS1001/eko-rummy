# Instrucciones de despliegue

## Opción A: Docker Compose (recomendada)
En un servidor Linux con Docker y un dominio apuntando a su IP:
```bash
cp .env.example .env
# Completa DOMAIN, PUBLIC_URL, AUTH_SECRET (openssl rand -hex 32), ADMIN_USERS
docker compose up -d --build
```
- `app`: el juego en el puerto interno 8080, datos en el volumen `eko-data`.
- `caddy`: HTTPS automático con Let's Encrypt en 80/443.
- `backup`: copia de seguridad de la base cada 6 horas en `./backups`, conserva 14 días.

> Estado: los archivos Docker están escritos pero **no se pudieron construir en el entorno de desarrollo** (no había demonio de Docker). Hay que hacer la primera construcción en el servidor y revisar que el `healthcheck` pase (`docker compose ps`).

## Opción B: Node directo (PM2 o systemd)
```bash
npm install --omit=dev && npm run build
NODE_ENV=production node --disable-warning=ExperimentalWarning apps/server/src/index.ts
```
Coloca delante un proxy con HTTPS (Caddy, Nginx) que reenvíe también `/ws` (WebSocket).

## Stripe
1. En el panel de Stripe crea un endpoint de webhook a `https://TU-DOMINIO/api/stripe/webhook` con los eventos `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `charge.refunded`.
2. Copia el secreto `whsec_…` a `STRIPE_WEBHOOK_SECRET` y la clave `sk_test_…` a `STRIPE_SECRET_KEY`.
3. Prueba con la tarjeta 4242 4242 4242 4242.
4. Pasar a producción: confirma con Stripe la elegibilidad del giro (artículos cosméticos digitales), cambia a `sk_live_…` y pon `STRIPE_LIVE_APPROVED=true`.

## Escalamiento
Un solo proceso Node atiende cientos de partidas simultáneas (las pruebas corren 8 en paralelo con IA en un proceso). Para varios servidores se necesita: base PostgreSQL compartida (esquema en `db/migrations/001_init.pg.sql`, adaptador pendiente), afinidad de sesión por sala en el balanceador y un bus (Redis) para invitaciones entre nodos. No está implementado; no hace falta para el lanzamiento.

## Recuperación ante fallos
- Cada cambio de una partida en curso se respalda en la tabla `active_games`. Si el proceso se reinicia o cae, al volver reconstruye las salas; los jugadores que reabren la app regresan a su asiento con su atril (probado automáticamente).
- El registro de auditoría encadenado por hash permite detectar alteraciones (`/admin.html` → Registro de auditoría).
