# Documentación de la API

Base: el mismo dominio del juego. Respuestas JSON. Autenticación con `Authorization: Bearer <token>` (token firmado HMAC-SHA256, 7 días; invitados 30 días). Límite general: 120 solicitudes por IP con recarga de 2/s; acceso/registro: 10 intentos por IP.

## REST

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/api/health` | — | Estado y salas activas |
| POST | `/api/auth/register` | — | `{username, password}` → `{token, user}` |
| POST | `/api/auth/login` | — | `{username, password}` → `{token, user}` |
| POST | `/api/auth/guest` | — | `{name?}` → token de invitado |
| GET | `/api/me` | sí | Perfil, Elo, estadísticas, cosméticos, billetera |
| GET | `/api/leaderboard` | — | Top 100 por Elo |
| GET | `/api/history` | cuenta | Últimas 20 partidas |
| GET/POST | `/api/friends` | cuenta | Listar / agregar `{username}` |
| DELETE | `/api/friends/:id` | cuenta | Quitar amigo |
| POST | `/api/friends/invite` | cuenta | `{friendId, code}` envía invitación en tiempo real |
| POST | `/api/report` | sí | `{target?, matchId?, reason}` |
| GET | `/api/tournaments` | — | Torneos de los últimos 7 días |
| POST | `/api/tournaments` | cuenta | `{name, size: 4|8}` |
| POST | `/api/tournaments/:id/join` | sí | Inscribirse |
| GET | `/api/shop` | — | Catálogo cosmético y modo de Stripe |
| POST | `/api/shop/checkout` | cuenta | `{product, requestId}` → `{url}` de Stripe Checkout |
| GET | `/api/purchases` | cuenta | Historial de compras |
| POST | `/api/stripe/webhook` | firma Stripe | Webhook (verificación de firma, tolerancia 5 min, idempotente) |
| GET | `/api/web3/token` | — | Datos verificados de EKOKIIN + lectura en cadena |
| GET | `/api/web3/balance/:addr` | — | Saldo EKOKIIN de una dirección |
| GET | `/api/web3/transfers/:addr` | — | Transferencias EKOKIIN |
| POST | `/api/web3/link` | cuenta | `{address}` guarda solo la dirección pública |
| GET | `/api/betting/status` | — | Estado del candado (siempre lectura) |

### Administración (rol admin, revalidado contra la base en cada solicitud)
`GET /api/admin/overview` · `GET /api/admin/users` · `POST /api/admin/users/:id/ban {banned}` · `GET /api/admin/matches` · `GET /api/admin/reports` · `POST /api/admin/reports/:id {status}` · `GET /api/admin/errors` · `GET /api/admin/purchases` · `GET /api/admin/tournaments` · `POST /api/admin/flags {key, value}` (solo `maintenance`, `chat_enabled`, `tournaments_enabled`, `registration_enabled`, `announcement`; el módulo económico no es una bandera).

## WebSocket `/ws`
Mensajes JSON con campo `t`. El primer mensaje debe ser `hello` (10 s de plazo). Límite: 30 mensajes con recarga de 10/s; chat 5 con recarga de 1 cada 2 s.

**Cliente → servidor**

| `t` | Campos | |
|---|---|---|
| `hello` | `token` | Autentica; si había partida en curso, el servidor reenvía el estado (reconexión) |
| `create` | `size`, `teams`, `turnSeconds`, `rounds` | Sala privada |
| `join` | `code` | Unirse a sala |
| `quick` | `size` o `teams` | Emparejamiento automático |
| `cancel_quick` | | |
| `add_bot` | `level` | Solo anfitrión |
| `start` | | Solo anfitrión |
| `play` | `table: number[][]`, `turn`, `nonce` | Mesa completa propuesta |
| `draw` | `turn`, `nonce` | Robar o pasar |
| `chat` | `text` | Moderado |
| `emote` | `e` | Lista cerrada |
| `leave` / `sync` / `ping` | | |

`turn` debe coincidir con el número de turno actual (evita jugadas viejas); `nonce` único evita duplicados.

**Servidor → cliente:** `welcome`, `lobby`, `queued`, `state` (vista privada del jugador + `deadline` + presencia), `move_rejected` (código, mensaje y estado para restaurar), `event`, `drawn`, `presence`, `chat`, `emote`, `game_over`, `invite`, `tournament_match`, `error`.

Códigos de rechazo: `NOT_YOUR_TURN`, `STALE_TURN`, `DUPLICATE_MOVE`, `BAD_FORMAT`, `BAD_TILE`, `DUPLICATE`, `TABLE_TILE_REMOVED`, `NOT_IN_RACK`, `NO_TILES`, `INVALID_SET`, `NOT_OPENED_MANIPULATION`, `OPENING_TOO_LOW`.
