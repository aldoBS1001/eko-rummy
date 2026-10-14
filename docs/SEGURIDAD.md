# Documentación de seguridad

## Integridad del juego
- **Servidor autoritativo:** el cliente envía la mesa propuesta; el servidor la valida completa con el mismo motor (`validatePlay`) y aplica o rechaza. Nunca se confía en el cliente.
- **Información oculta:** cada jugador recibe una vista (`viewFor`) sin atriles ajenos ni pozo. Probado en motor, servidor y navegador.
- **Integridad de fichas:** después de cada jugada se verifica que existan exactamente 106 fichas sin duplicados ni faltantes; un estado corrupto nunca se aplica y queda en auditoría.
- **Duplicados y repetición:** cada movimiento lleva `nonce` único y el número de turno; duplicados y jugadas viejas se rechazan.
- **Concurrencia:** cada sala procesa sus mensajes en el hilo único de Node; no hay carreras entre jugadas.
- **Aleatoriedad:** CSPRNG sin sesgo; hash del orden del pozo publicado al iniciar la partida.
- **Colusión:** varios jugadores con la misma IP en partida pública generan un reporte automático para revisión.
- **IA:** solo recibe su propia vista; no puede ver fichas ocultas.

## Cuentas y sesiones
- Contraseñas con scrypt (N=16384, sal de 16 bytes, comparación en tiempo constante).
- Tokens HMAC-SHA256 con expiración; el rol y el bloqueo se revalidan contra la base en cada solicitud y conexión.
- Usuario bloqueado: se cierran sus conexiones y no puede volver a entrar.
- Una cuenta en otro dispositivo reemplaza la sesión de juego anterior.

## Red y aplicación
- Límites de ritmo por IP (HTTP), por intento de acceso y por conexión (WebSocket y chat).
- Tamaño máximo de mensaje WebSocket 32 KB y de cuerpo HTTP 64 KB (webhook 512 KB).
- Encabezados: CSP restrictiva, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, HSTS en producción.
- Sin SQL dinámico: todas las consultas usan sentencias preparadas.
- XSS: el chat y los nombres se insertan siempre como texto (`textContent`), nunca como HTML; el chat además filtra enlaces y caracteres de control.
- Archivos estáticos protegidos contra recorrido de rutas.

## Pagos y blockchain
- Stripe: verificación de firma del webhook con tolerancia de 5 minutos (anti-replay), idempotencia por id de evento, verificación de monto, claves live bloqueadas sin aprobación explícita, `Idempotency-Key` en la creación de sesiones. No se manejan datos de tarjeta.
- Pagos y blockchain están separados: la tienda nunca concede fichas, saldo ni nada canjeable.
- TRON: solo lectura; ninguna llave privada en servidor ni cliente.

## Auditoría
Tabla `audit` encadenada por SHA-256 (registro, inicio y fin de partidas, abandonos, compras, reembolsos, acciones de administradores, violaciones de integridad, reinicios). El panel muestra si la cadena está íntegra; las pruebas comprueban que una alteración se detecta.

## Entornos
`NODE_ENV` separa desarrollo, pruebas y producción. En producción el servidor no arranca sin `AUTH_SECRET` fuerte. Los secretos solo viven en variables de entorno (`.env`, excluido del repositorio).

## Pendiente
- Pruebas de penetración externas.
- Verificación de correo y recuperación de contraseña (requiere proveedor de correo).
- Detección avanzada de bots (patrones de tiempo de respuesta).
