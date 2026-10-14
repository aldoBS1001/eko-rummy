// EKO RUMMY para Windows: un solo .exe que se instala (por usuario, sin permisos de administrador),
// crea accesos directos, se registra en "Aplicaciones instaladas" y abre el juego en su propia ventana.
// El juego va embebido y se sirve en 127.0.0.1; la partida contra la IA funciona sin internet.
//go:build windows

package main

import (
	_ "embed"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

//go:embed eko-rummy.ico
var iconData []byte

const (
	appName    = "EKO RUMMY"
	appVersion = "1.0.0"
	publisher  = "Business Shop"
	port       = "47831" // puerto fijo: conserva los ajustes y el progreso entre sesiones
	regKey     = `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\EkoRummy`
)

var (
	user32      = syscall.NewLazyDLL("user32.dll")
	messageBoxW = user32.NewProc("MessageBoxW")
)

const (
	mbOK          = 0x0
	mbYesNo       = 0x4
	mbIconInfo    = 0x40
	mbIconWarning = 0x30
	mbIconError   = 0x10
	idYes         = 6
	noWindow      = 0x08000000 // CREATE_NO_WINDOW
)

func msg(text string, flags uintptr) int {
	t, _ := syscall.UTF16PtrFromString(text)
	c, _ := syscall.UTF16PtrFromString(appName)
	r, _, _ := messageBoxW.Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(c)), flags)
	return int(r)
}

func installDir() string { return filepath.Join(os.Getenv("LOCALAPPDATA"), "Programs", "EKO RUMMY") }
func installedExe() string { return filepath.Join(installDir(), "EKO RUMMY.exe") }

func hidden(name string, args ...string) *exec.Cmd {
	cmd := exec.Command(name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: noWindow}
	return cmd
}

func has(args []string, flag string) bool {
	for _, a := range args {
		if strings.EqualFold(a, flag) {
			return true
		}
	}
	return false
}

func main() {
	args := os.Args[1:]
	if has(args, "--desinstalar") {
		uninstall(has(args, "--silencioso"))
		return
	}
	self, _ := os.Executable()
	if has(args, "--portatil") || strings.EqualFold(filepath.Clean(self), filepath.Clean(installedExe())) {
		run()
		return
	}
	// Ejecutado desde Descargas u otra carpeta: instalar.
	if msg("¿Instalar EKO RUMMY en este equipo?\n\nSe agregará al menú Inicio y al escritorio. No requiere permisos de administrador.", mbYesNo|mbIconInfo) != idYes {
		return
	}
	if err := install(self); err != nil {
		msg("No se pudo completar la instalación:\n"+err.Error()+"\n\nPuedes jugar sin instalar ejecutando el archivo con --portatil.", mbOK|mbIconError)
		return
	}
	msg("EKO RUMMY quedó instalado.\n\nLo encontrarás en el menú Inicio y en el escritorio. Se abrirá ahora.", mbOK|mbIconInfo)
	_ = exec.Command(installedExe()).Start()
}

func copyFile(src, dst string) error {
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	tmp := dst + ".nuevo"
	if err := os.WriteFile(tmp, data, 0o755); err != nil {
		return err
	}
	_ = os.Remove(dst)
	return os.Rename(tmp, dst)
}

func psQuote(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }

func shortcut(lnk, target, icon string) error {
	script := fmt.Sprintf(`$s=(New-Object -ComObject WScript.Shell).CreateShortcut(%s);$s.TargetPath=%s;$s.WorkingDirectory=%s;$s.IconLocation=%s;$s.Description='Juego EKO RUMMY de Business Shop';$s.Save()`,
		psQuote(lnk), psQuote(target), psQuote(filepath.Dir(target)), psQuote(icon+",0"))
	return hidden("powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script).Run()
}

func install(self string) error {
	dir := installDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	// Cerrar una instancia abierta antes de reemplazar el ejecutable.
	_ = hidden("taskkill", "/IM", "EKO RUMMY.exe", "/F").Run()
	time.Sleep(400 * time.Millisecond)
	if err := copyFile(self, installedExe()); err != nil {
		return err
	}
	icon := filepath.Join(dir, "eko-rummy.ico")
	if err := os.WriteFile(icon, iconData, 0o644); err != nil {
		return err
	}
	startMenu := filepath.Join(os.Getenv("APPDATA"), `Microsoft\Windows\Start Menu\Programs`)
	desktop := filepath.Join(os.Getenv("USERPROFILE"), "Desktop")
	if err := shortcut(filepath.Join(startMenu, "EKO RUMMY.lnk"), installedExe(), icon); err != nil {
		return errors.New("no se pudo crear el acceso directo del menú Inicio")
	}
	_ = shortcut(filepath.Join(desktop, "EKO RUMMY.lnk"), installedExe(), icon) // el escritorio puede estar redirigido (OneDrive)
	// Registro en Configuración › Aplicaciones (por usuario)
	vals := [][2]string{
		{"DisplayName", appName}, {"DisplayVersion", appVersion}, {"Publisher", publisher},
		{"DisplayIcon", icon}, {"InstallLocation", dir},
		{"UninstallString", fmt.Sprintf(`"%s" --desinstalar`, installedExe())},
		{"QuietUninstallString", fmt.Sprintf(`"%s" --desinstalar --silencioso`, installedExe())},
	}
	for _, v := range vals {
		_ = hidden("reg", "add", regKey, "/v", v[0], "/t", "REG_SZ", "/d", v[1], "/f").Run()
	}
	_ = hidden("reg", "add", regKey, "/v", "NoModify", "/t", "REG_DWORD", "/d", "1", "/f").Run()
	_ = hidden("reg", "add", regKey, "/v", "NoRepair", "/t", "REG_DWORD", "/d", "1", "/f").Run()
	return nil
}

func uninstall(silent bool) {
	if !silent && msg("¿Desinstalar EKO RUMMY?\n\nSe borrarán el juego, sus accesos directos y tu progreso local.", mbYesNo|mbIconWarning) != idYes {
		return
	}
	_ = os.Remove(filepath.Join(os.Getenv("APPDATA"), `Microsoft\Windows\Start Menu\Programs`, "EKO RUMMY.lnk"))
	_ = os.Remove(filepath.Join(os.Getenv("USERPROFILE"), "Desktop", "EKO RUMMY.lnk"))
	_ = hidden("reg", "delete", regKey, "/f").Run()
	// El ejecutable en uso no puede borrarse a sí mismo: se programa el borrado de la carpeta.
	_ = hidden("cmd", "/C", fmt.Sprintf(`ping 127.0.0.1 -n 3 >nul & rmdir /S /Q "%s"`, installDir())).Start()
	if !silent {
		msg("EKO RUMMY se desinstaló.", mbOK|mbIconInfo)
	}
}

// ---------- ejecución del juego ----------

func findBrowser() (string, bool) {
	cands := []string{
		filepath.Join(os.Getenv("ProgramFiles(x86)"), `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(os.Getenv("ProgramFiles"), `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(os.Getenv("LOCALAPPDATA"), `Microsoft\Edge\Application\msedge.exe`),
		filepath.Join(os.Getenv("ProgramFiles"), `Google\Chrome\Application\chrome.exe`),
		filepath.Join(os.Getenv("ProgramFiles(x86)"), `Google\Chrome\Application\chrome.exe`),
		filepath.Join(os.Getenv("LOCALAPPDATA"), `Google\Chrome\Application\chrome.exe`),
	}
	for _, c := range cands {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c, true
		}
	}
	return "", false
}

func openWindow(url string) *exec.Cmd {
	if b, ok := findBrowser(); ok {
		profile := filepath.Join(installDir(), "perfil")
		cmd := exec.Command(b, "--app="+url, "--user-data-dir="+profile, "--no-first-run", "--no-default-browser-check",
			"--disable-features=Translate", "--window-size=1280,820", "--lang=es-MX")
		if err := cmd.Start(); err == nil {
			return cmd
		}
	}
	// Sin Edge ni Chrome: navegador predeterminado.
	_ = hidden("rundll32", "url.dll,FileProtocolHandler", url).Start()
	return nil
}

func run() {
	url := "http://127.0.0.1:" + port + "/"
	ln, err := net.Listen("tcp", "127.0.0.1:"+port)
	if err != nil {
		// Ya hay una instancia sirviendo el juego: solo abrir otra ventana.
		if resp, e := http.Get(url + "health-eko"); e == nil {
			resp.Body.Close()
			openWindow(url)
			return
		}
		msg("El puerto "+port+" está ocupado por otro programa. Cierra ese programa e intenta de nuevo.", mbOK|mbIconError)
		return
	}
	srv := &http.Server{Handler: handler(), ReadHeaderTimeout: 10 * time.Second}
	go srv.Serve(ln)
	cmd := openWindow(url)
	if cmd != nil {
		_ = cmd.Wait()
		// Si el navegador entregó la ventana a un proceso ya abierto con este perfil, el proceso
		// lanzado termina enseguida: se sigue sirviendo mientras el perfil esté en uso.
		time.Sleep(1500 * time.Millisecond)
		if !profileInUse() {
			return
		}
	}
	// Respaldo: seguir sirviendo mientras haya una ventana del juego abierta (perfil bloqueado).
	for profileInUse() {
		time.Sleep(5 * time.Second)
	}
}

// profileInUse indica si alguna ventana del navegador sigue usando el perfil del juego.
func profileInUse() bool {
	lock := filepath.Join(installDir(), "perfil", "lockfile")
	f, err := os.OpenFile(lock, os.O_RDWR, 0)
	if err != nil {
		// En Windows el archivo de bloqueo está abierto en exclusiva mientras el navegador corre.
		_, statErr := os.Stat(lock)
		return statErr == nil
	}
	f.Close()
	return false
}
