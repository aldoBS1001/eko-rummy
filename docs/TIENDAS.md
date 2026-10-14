# iPhone, Android y Windows

## Hoy: app instalable (PWA) — sin pasar por tiendas
Con el juego desplegado en HTTPS:

| Dispositivo | Cómo se instala | Qué se probó |
|---|---|---|
| iPhone / iPad | Safari → Compartir → "Agregar a pantalla de inicio". Abre a pantalla completa con ícono propio. | Emulación iPhone 13 (pantalla, toque, arrastre, partida completa de turnos, tutorial) |
| Android | Chrome muestra "Instalar app" (el juego también ofrece el botón). | Emulación Pixel 7 (igual que arriba + multijugador) |
| Windows | Edge o Chrome → ícono de instalar en la barra de direcciones. Queda en el menú Inicio. | Escritorio 1366×768 con mouse (igual que arriba + panel admin) |

Las pruebas usaron Chromium emulando cada dispositivo. **No se probó en hardware real ni en el motor WebKit de Safari**; antes del lanzamiento conviene una ronda manual en un iPhone y un Android físicos.

La partida contra la IA funciona sin conexión gracias al service worker.

## Siguiente paso: publicar en tiendas
El mismo código se empaqueta sin reescribirlo:

**Google Play y Microsoft Store — PWABuilder (pwabuilder.com)**
1. Introduce la URL del juego publicado; genera el paquete Android (Trusted Web Activity) y el paquete MSIX de Windows.
2. Google Play: cuenta de Google Play Console; sube el `.aab` y el archivo `assetlinks.json` que genera PWABuilder en `/.well-known/` del dominio.
3. Microsoft Store: cuenta de Partner Center; sube el `.msix`.

**App Store — Capacitor**
1. En una Mac con Xcode: `npm i @capacitor/core @capacitor/cli @capacitor/ios && npx cap init "EKO RUMMY" com.businessshop.ekorummy --web-dir apps/web/dist && npx cap add ios`.
2. Configura en Ajustes del juego la URL del servidor (o fija `serverUrl`) porque la app empaquetada no está en el mismo dominio.
3. Firma con la cuenta de Apple Developer de Business Shop A&A y envía a revisión.

**Antes de enviar a revisión**
- Apple y Google limitan las funciones con criptomonedas y prohíben juegos con dinero real sin licencia. La versión para tiendas debe salir con el módulo económico bloqueado (como está) y conviene ocultar la sección Web3 en iOS hasta revisar las guías 3.1.5 y 5.3 de Apple.
- Las compras de artículos digitales dentro de apps de tienda deben hacerse con el sistema de pagos de Apple/Google, no con Stripe. En la web y la PWA, Stripe sí aplica.
- Se necesita aviso de privacidad, clasificación por edades y contacto de soporte.
