# Manual del administrador

Entra a `https://TU-DOMINIO/admin.html` con una cuenta incluida en `ADMIN_USERS`. Los datos se actualizan cada 30 segundos.

## Indicadores
Usuarios registrados, conectados ahora, partidas activas y terminadas, activos en 24 h, retención D1 y D7 (porcentaje de usuarios que volvieron después de 1 y 7 días), reportes abiertos, ventas, errores en 24 h, memoria del servidor y jugadores en cola de emparejamiento.

## Estado de integraciones
Stripe (sin configurar, prueba, producción o clave live bloqueada), red TRON y contrato, integridad del registro de auditoría y estado del módulo económico.

## Módulo económico
Tabla de solo lectura con cada aprobación pendiente. No se activa desde aquí (ver CUMPLIMIENTO.md).

## Controles de funciones
- **Mantenimiento:** impide crear partidas nuevas; las que están en curso terminan normalmente.
- **Chat**, **Torneos**, **Registro de cuentas:** activar o desactivar.
- **Aviso:** texto que ven todos los jugadores al conectarse.

Cada cambio queda en la auditoría con el administrador que lo hizo.

## Partidas
Activas (sala, modo, ronda y turno, jugadores, quién es IA y quién está desconectado) y recientes con resultados.

## Reportes de fraude y conducta
Reportes de jugadores y automáticos (por ejemplo, varios jugadores desde la misma IP en una partida pública). Marca cada uno como resuelto o descartado.

## Usuarios
Lista con rol, Elo, fecha de alta y billetera vinculada. **Bloquear** cierra sus conexiones al instante e impide volver a entrar.

## Transacciones comerciales
Compras de Stripe con estado (pendiente, pagada, expirada, reembolsada). Los reembolsos se hacen desde el panel de Stripe; el webhook retira el artículo automáticamente.

## Errores
Últimos errores del servidor (HTTP, WebSocket, IA, Stripe, restauración).

## Configuración de reglas
Los valores de reglas (tiempo por turno por defecto, gracia de reconexión, relleno con IA) se fijan con variables de entorno (`TURN_SECONDS`, `RECONNECT_GRACE_SECONDS`, `QUICK_MATCH_BOT_FILL_SECONDS`). Los anfitriones eligen tiempo y rondas al crear su sala. La apertura de 30 puntos y la penalización de comodín de 30 están en `DEFAULT_CONFIG` del motor.

## Gestión de contenido
El aviso global es el contenido editable desde el panel. Textos del juego, catálogo de la tienda (`apps/server/src/payments/stripe.ts`) y torneos se gestionan en código o desde el propio juego (los torneos los crea cualquier usuario registrado).
