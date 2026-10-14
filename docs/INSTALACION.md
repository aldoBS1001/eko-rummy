# Manual de instalación

## Requisitos
- Node.js **22.18 o superior** (usa tipos de TypeScript nativos, `node:sqlite` y `node:test`).
- Para producción: un servidor Linux con Docker o Node, un dominio y HTTPS.

## Instalación local
```bash
unzip eko-rummy.zip && cd eko-rummy
npm install                 # instala ws (WebSocket), esbuild, typescript y playwright
cp .env.example .env        # en desarrollo puede quedar casi vacío
npm run build
npm start
```
Abre `http://localhost:8080`. Para probar desde un teléfono en la misma red usa la IP de la computadora (`http://192.168.x.x:8080`). Para instalar como app en el teléfono se necesita HTTPS (ver despliegue).

## Variables de entorno
Ver `.env.example`. Las más importantes:

| Variable | Uso |
|---|---|
| `AUTH_SECRET` | Obligatoria en producción (≥32 caracteres). Firma las sesiones. |
| `ADMIN_USERS` | Usuarios con acceso al panel administrativo. |
| `DB_PATH` | Archivo SQLite con usuarios, partidas, compras y auditoría. |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Pagos de la tienda. Con `sk_test_` funciona en modo prueba. Las claves `sk_live_` quedan bloqueadas hasta `STRIPE_LIVE_APPROVED=true`. |
| `TRON_API_KEY` | Opcional; clave de TronGrid para más cuota de consultas. |
| `BETTING_ENABLED` + `COMPLIANCE_FILE` | Candado del módulo económico. Ver CUMPLIMIENTO.md. |

## Pruebas
```bash
npm test          # motor, IA (partidas completas) y servidor (WebSocket real)
npm run test:e2e  # navegador emulando iPhone 13, Pixel 7 y Windows
npm run typecheck
```

## Primer administrador
1. Pon tu usuario en `ADMIN_USERS` (por ejemplo `ADMIN_USERS=aldo`).
2. Reinicia el servidor, crea la cuenta desde Perfil en el juego.
3. Entra a `/admin.html`.
