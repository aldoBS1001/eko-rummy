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

**App Store — Capacitor, compilado en GitHub (sin Mac)**
El flujo `.github/workflows/ios.yml` genera el proyecto iOS con Capacitor, lo firma con firma automática y lo sube a App Store Connect.
1. developer.apple.com → Identifiers → registra `com.businessshop.ekorummy`.
2. App Store Connect → Apps → + → Nueva app con ese Bundle ID.
3. App Store Connect → Usuarios y acceso → Integraciones → crea una llave de API con acceso **Admin** y guarda en GitHub Secrets: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`, `APPLE_TEAM_ID` y `EKO_SERVER_URL`.
4. GitHub → Actions → **iOS · App Store** → Run workflow. El build aparece en TestFlight en 10–30 min.

La versión para tiendas se compila con `EKO_STORE_BUILD=1`: oculta Web3, la tienda con Stripe, KYC y el panel administrativo, y agrega **Eliminar mi cuenta** (obligatorio en App Store y Google Play).

**Antes de enviar a revisión**
- Apple y Google limitan las funciones con criptomonedas y prohíben juegos con dinero real sin licencia. La versión para tiendas debe salir con el módulo económico bloqueado (como está) y conviene ocultar la sección Web3 en iOS hasta revisar las guías 3.1.5 y 5.3 de Apple.
- Las compras de artículos digitales dentro de apps de tienda deben hacerse con el sistema de pagos de Apple/Google, no con Stripe. En la web y la PWA, Stripe sí aplica.
- Se necesita aviso de privacidad, clasificación por edades y contacto de soporte.
