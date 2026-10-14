# Verificación de identidad (KYC) con Sumsub

## Qué hace
- Disponible para cuentas registradas que declararon ser mayores de 18 años (Perfil › Verificación de identidad).
- El juego abre `/kyc.html` con un enlace de un solo uso (15 minutos). En Android (APK) se abre en Chrome y en Windows en otra ventana, para tener acceso a la cámara.
- La página pide **consentimiento expreso** para datos biométricos (LFPDPPP, datos sensibles) y luego lanza el WebSDK oficial de Sumsub en español.
- Sumsub revisa identificación oficial + selfie y avisa el resultado al servidor por webhook firmado.
- Estados: Sin verificar, En proceso, En revisión, En revisión adicional, Requiere corrección (puede reintentar), Verificada, Rechazada (final).
- Solo las cuentas **Verificadas** y mayores de edad son elegibles para funciones con valor económico (`economicEligibility`). El módulo económico sigue bloqueado por su propio candado de permisos.
- No se guardan documentos ni fotos: solo el id del solicitante en Sumsub, el estado, los motivos de rechazo y la fecha. Todo cambio queda en la auditoría.

## Configurar Sumsub (una vez)
1. En el panel de Sumsub crea un **nivel de verificación** (por ejemplo `basic-kyc-level`) con: documento de identidad (INE, pasaporte) y selfie con prueba de vida. Activa la verificación de edad mínima 18.
2. En **Dev space › App tokens** genera un App Token y su Secret Key (primero en *Sandbox* para probar).
3. En **Dev space › Webhooks** crea un webhook:
   - URL: `https://TU-DOMINIO/api/kyc/webhook`
   - Algoritmo de firma: `HMAC_SHA256_HEX` y un secreto.
   - Eventos: `applicantCreated`, `applicantPending`, `applicantReviewed`, `applicantOnHold`, `applicantReset`.
4. Pon en `.env`: `SUMSUB_APP_TOKEN`, `SUMSUB_SECRET_KEY`, `SUMSUB_WEBHOOK_SECRET`, `SUMSUB_LEVEL_NAME` y reinicia.
5. En el panel de administración aparece "KYC (Sumsub): Activo".

En Sandbox, Sumsub permite simular la respuesta (aprobado o rechazado) desde su panel para probar el flujo completo.

## API
| Método | Ruta | Uso |
|---|---|---|
| GET | `/api/kyc/status` | Estado, motivos y elegibilidad económica del usuario |
| POST | `/api/kyc/start` | Crea el enlace de un solo uso a `/kyc.html` |
| POST | `/api/kyc/token` | Canjea el código por un token del WebSDK (una vez) |
| POST | `/api/kyc/token/refresh` | Renueva el token durante la sesión de verificación |
| POST | `/api/kyc/refresh` | Consulta directa a Sumsub (por si el webhook se retrasa) |
| POST | `/api/kyc/webhook` | Webhook de Sumsub (firma `X-Payload-Digest`) |

Las llamadas a Sumsub se firman con `X-App-Token`, `X-App-Access-Ts` y `X-App-Access-Sig = hex(HMAC_SHA256(secret, ts + MÉTODO + ruta + cuerpo))`.

## Pruebas
Se probaron con un servidor que simula Sumsub y valida las firmas igual que la API real: inicio, código de un solo uso, renovación de token, webhook con firma válida e inválida, aprobación, corrección, rechazo final, consulta directa, protección contra eventos atrasados y la página en un iPhone emulado con un SDK simulado. **Falta una prueba con tus claves reales de Sandbox de Sumsub.**
