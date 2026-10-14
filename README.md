# EKO RUMMY

Juego de fichas tipo Rummy de **Business Shop / EKO K'iin** para **iPhone, Android y Windows** (app web instalable, PWA), con modo gratuito contra la IA, multijugador en tiempo real, equipos 2 contra 2, torneos gratuitos, clasificación mundial, integración de solo lectura con el token **EKOKIIN (TRC-20, TRON)**, tienda cosmética con **Stripe** y un módulo de partidas con valor económico **bloqueado** hasta contar con autorizaciones.

## Arranque rápido (desarrollo)

```bash
# Requisitos: Node.js 22.18 o superior
npm install
npm run build          # compila el cliente a apps/web/dist
npm start              # http://localhost:8080
npm test               # 82 pruebas de motor, IA, servidor y KYC
npm run test:e2e       # 57 comprobaciones en navegador (iPhone, Android, Windows)
```

Panel administrativo: `http://localhost:8080/admin.html` (el usuario debe estar en `ADMIN_USERS`).

## Estructura

| Ruta | Contenido |
|---|---|
| `packages/engine` | Motor de reglas puro (fichas, validación, turnos, puntuación, equipos) e IA de 4 niveles |
| `apps/server` | Servidor HTTP + WebSocket autoritativo: salas, emparejamiento, reconexión, chat, cuentas, Elo, torneos, amigos, admin, Stripe, TRON, candado de apuestas, simulador de custodia |
| `apps/web` | Cliente PWA: tablero, arrastrar y soltar, tutorial, Web3 con TronLink, perfil, tienda, panel admin |
| `db/migrations` | Esquema SQL para PostgreSQL |
| `docs/` | Manuales, API, seguridad, cumplimiento, reporte de pruebas, publicación en tiendas |
| `compliance/` | Plantilla de aprobaciones regulatorias del módulo económico |

## Documentación

- [Manual de instalación](docs/INSTALACION.md)
- [Instrucciones de despliegue](docs/DESPLIEGUE.md)
- [Servidor gratuito: Render y Oracle Cloud](docs/SERVIDOR_GRATIS.md)
- [Publicación en App Store, Google Play y Microsoft Store](docs/TIENDAS.md)
- [Manual del administrador](docs/ADMIN.md)
- [Reglamento EKO RUMMY](docs/REGLAS.md)
- [Documentación de la API](docs/API.md)
- [Web3 y token EKOKIIN (validación en cadena)](docs/WEB3.md)
- [Verificación de identidad (KYC) con Sumsub](docs/KYC.md)
- [Documentación de seguridad](docs/SEGURIDAD.md)
- [Informe de cumplimiento pendiente](docs/CUMPLIMIENTO.md)
- [Reporte de pruebas](docs/REPORTE_PRUEBAS.md)
