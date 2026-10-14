# Servidor gratuito: Render (prueba) y Oracle Cloud (permanente)

El código vive en el repositorio privado `github.com/aldoBS1001/eko-rummy`. Los dos servidores se actualizan solos cuando el repositorio cambia.

| | Render (free) | Oracle Cloud Always Free |
|---|---|---|
| Uso | Probar con amigos hoy | Servidor definitivo |
| Costo | $0, sin tarjeta | $0 (pide tarjeta solo para verificar identidad) |
| Datos | Se **borran** al reiniciarse (cuentas, clasificación) | Se conservan, con respaldo cada 6 h |
| Disponibilidad | Se duerme tras 15 min sin uso; despierta en ~1 min | Siempre encendido |
| Dirección | `https://eko-rummy-XXXX.onrender.com` | `https://IP-CON-GUIONES.sslip.io` o tu dominio |

---

## A. Render (5 minutos)

1. Entra a https://render.com y elige **Sign up with GitHub** (cuenta aldoBS1001). Autoriza el acceso al repositorio `eko-rummy`.
2. Abre https://render.com/deploy?repo=https://github.com/aldoBS1001/eko-rummy
3. Escribe un nombre para el Blueprint (p. ej. `eko-rummy`) y da clic en **Deploy Blueprint**. Ya trae todo configurado (`render.yaml`): plan gratuito, secreto de sesiones generado automáticamente y apuestas bloqueadas.
4. Espera a que el servicio diga **Live** (5–8 min la primera vez). La dirección aparece arriba: `https://eko-rummy-….onrender.com`.

Esa dirección se abre en cualquier navegador (iPhone, Android, Windows) y desde ahí se puede instalar como app con "Agregar a pantalla de inicio".

---

## B. Oracle Cloud Always Free (20 minutos de clics + 10 de instalación automática)

### 1. Token de lectura de GitHub (para que el servidor descargue el código privado)
GitHub › foto de perfil › **Settings** › **Developer settings** › **Personal access tokens** › **Fine-grained tokens** › **Generate new token**:
- Nombre: `oracle-eko-rummy`; vencimiento: el más largo disponible.
- **Repository access:** *Only select repositories* › `eko-rummy`.
- **Permissions › Repository permissions › Contents:** *Read-only* (nada más).
- **Generate token** y copia el valor (`github_pat_…`).

### 2. Cuenta de Oracle
https://signup.cloud.oracle.com. La **región de origen no se puede cambiar después**; elige una cercana a tus jugadores (p. ej. *Mexico Central (Querétaro)* o *US West (Phoenix)*). La tarjeta es para verificar identidad; mientras uses solo recursos "Always Free" no hay cargos.

### 3. Crear la máquina virtual
Menú ☰ › **Compute** › **Instances** › **Create instance**:
- **Image:** *Change image* › **Canonical Ubuntu 24.04**.
- **Shape:** *Change shape* › **Ampere** › `VM.Standard.A1.Flex` con **2 OCPU y 12 GB** de memoria.
  Si dice *Out of capacity*, usa **Specialty and previous generation** › `VM.Standard.E2.1.Micro` (también gratis; el script le agrega memoria de intercambio).
- **Networking:** deja *Create new virtual cloud network* y *Assign a public IPv4 address* activado.
- **Add SSH keys:** *Generate a key pair for me* › **Save private key** (guárdala; no se puede volver a descargar).
- **Show advanced options** › **Management** › *Paste cloud-init script*: pega todo el contenido de `deploy/oracle/cloud-init.sh` y en la línea `GITHUB_TOKEN=` reemplaza `PEGA_AQUI_EL_TOKEN_DE_GITHUB` por tu token. Si tu usuario del juego no será `aldo`, cambia `ADMIN_USER`.
- **Create**.

### 4. Abrir los puertos web (80 y 443)
En la página de la instancia: **Primary VNIC › Subnet** › pestaña **Security** (o *Security Lists*) › **Default Security List** › **Add Ingress Rules**:
- Source CIDR `0.0.0.0/0`, IP Protocol **TCP**, Destination Port Range `80,443` › **Add Ingress Rules**.

### 5. Listo
Copia la **Public IP address** de la instancia (p. ej. `129.146.10.5`). Unos 10 minutos después de que la instancia diga *Running*, el juego está en:

`https://129-146-10-5.sslip.io` (la IP con guiones en lugar de puntos)

Lo primero: entra y **regístrate con el usuario `aldo`** (o el que pusiste en `ADMIN_USER`); esa cuenta tiene el panel `/admin.html`.

### Usar tu propio dominio después (opcional)
En GoDaddy crea un registro **A** `juego` → la IP pública de Oracle. Luego, en el servidor, cambia `DOMAIN` y `PUBLIC_URL` en `/opt/eko-rummy/.env` y ejecuta `docker compose up -d`. Caddy obtiene el certificado HTTPS solo.

### Qué hace el script automáticamente
Instala Docker, abre el firewall interno de Ubuntu, descarga el código, genera el secreto de sesiones, arranca el juego con HTTPS (Caddy + Let's Encrypt), programa respaldos de la base de datos cada 6 h (se guardan 14 días en `/opt/eko-rummy/backups`) y revisa GitHub cada 10 minutos para instalar actualizaciones. Registro de instalación: `/var/log/eko-rummy-install.log`.

---

## Apps instaladas (Windows / Android)
En **Configuración › Servidor** escribe la dirección del servidor (Render u Oracle) y pulsa **Guardar servidor**. Cuando haya dominio definitivo se recompilan los instaladores con esa dirección fija.
