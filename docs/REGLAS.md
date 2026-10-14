# Reglamento EKO RUMMY

Implementado en `packages/engine/src` y cubierto por pruebas automatizadas.

## Fichas
- 106 fichas: números 1–13 en cuatro colores (Jade, Sol, Coral, Noche), dos copias de cada una, y 2 comodines.
- Cada color lleva un símbolo (hoja, sol, gota, luna) para distinguirlos sin depender del color.
- Cada ficha tiene un identificador único e inmutable (0–105).

## Reparto
- 14 fichas por jugador; el resto forma el pozo.
- El servidor baraja con aleatoriedad criptográficamente segura (Fisher–Yates con `crypto.getRandomValues`, sin sesgo de módulo).
- Al iniciar una partida en línea se registra en la auditoría el hash SHA-256 del orden del pozo (compromiso verificable).
- Ningún cliente recibe atriles ajenos ni el orden del pozo: solo su atril, la mesa y conteos.

## Combinaciones
- **Grupo:** 3 o 4 fichas del mismo número, sin repetir color.
- **Escalera:** 3 a 13 números consecutivos del mismo color. El 1 solo es el valor más bajo (12-13-1 no es válida).
- Toda combinación lleva al menos una ficha real.

## Apertura
- La primera jugada de cada jugador debe formarse solo con fichas propias y sumar **30 puntos o más** (configurable).
- Antes de abrir no se puede tocar ninguna combinación de la mesa (se permite reacomodar visualmente una intacta).

## Comodines
- Sustituyen cualquier ficha. En un grupo valen el número del grupo; en una escalera, el número que ocupan.
- Si sobran comodines en los extremos de una escalera, se colocan arriba y, si no caben, abajo.
- Si una combinación admite lectura de grupo y de escalera, se toma la de mayor puntuación.
- Tras abrir, un comodín de la mesa puede recuperarse al reorganizar. Como **ninguna ficha de la mesa puede volver al atril**, el comodín recuperado queda obligatoriamente usado en una combinación válida al terminar ese mismo turno.

## Turno
- Colocar al menos una ficha (y dejar toda la mesa válida) o robar una ficha.
- Se puede reorganizar, dividir y reconstruir la mesa libremente tras abrir.
- Deshacer, reiniciar turno y ordenar atril están siempre disponibles en el cliente; el servidor solo recibe la mesa final y la valida completa.
- Una jugada inválida no altera el estado: el cliente restaura la mesa del inicio del turno.
- **Tiempo agotado:** se descarta lo movido y se roba 1 ficha de penalización (configurable).
- **Inactividad:** 3 tiempos agotados seguidos → la IA ocupa el asiento.
- **Desconexión:** el asiento se reserva (60 s por defecto); si no regresa, la IA juega por él con su atril.
- **Abandono:** la IA toma el asiento de inmediato; para la clasificación cuenta como partida jugada.

## Pozo agotado y bloqueo
- Con el pozo vacío, quien no juega pasa. Si todos pasan consecutivamente, la ronda se **bloquea**.
- En bloqueo gana quien tenga menos puntos en el atril (empate: menos fichas).

## Puntuación
- Fichas restantes restan su valor; cada comodín resta 30.
- El ganador suma lo que restan los demás.
- En bloqueo, cada perdedor paga la diferencia con el ganador.
- Partidas de 1, 3 o 5 rondas con marcador acumulado; la salida rota cada ronda.

## Equipos (variante EKO)
- 4 jugadores; asientos 1 y 3 forman el equipo A y 2 y 4 el B, así los turnos se alternan entre equipos.
- Gana la ronda el equipo de quien se queda sin fichas. Los integrantes del equipo perdedor restan su atril y el que cerró suma ese total. El compañero del ganador no suma ni resta.
- En bloqueo gana el equipo con menor suma de atriles y cobra la diferencia.
- Gana la partida el equipo con mayor marcador acumulado.
