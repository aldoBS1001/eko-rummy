# Reporte de pruebas

Fecha: 14 de octubre de 2026. Entorno: Linux, Node.js 22.22, Chromium (Playwright) emulando dispositivos.
Todos los resultados de este documento provienen de ejecuciones reales; los registros completos están en `build/test-unit-integration.log` y `build/test-e2e.log` dentro del ZIP.

## Resumen
| Suite | Resultado |
|---|---|
| Motor de reglas e IA (`packages/engine/test`) | 43/43 aprobadas |
| Servidor e integración por WebSocket real (`apps/server/test`) | 39/39 aprobadas |
| **Total unitarias + integración** | **82/82 aprobadas** |
| Navegador: iPhone 13, Pixel 7 (Android), Windows 1366×768 (`apps/web/test/e2e.mjs`) | 57/57 comprobaciones aprobadas (incluye edad, términos y KYC de punta a punta) |
| Instalador de Windows (`installers/windows`): compilación cruzada, recursos de ícono y manifiesto verificados en el .exe, servidor embebido probado y juego jugado en navegador sobre él | Aprobado. **No ejecutado en Windows real** (no había equipo Windows) |
| Verificación de tipos TypeScript (`tsc --noEmit`, modo estricto) | Sin errores |

Dato de calidad de la IA: en 30 partidas 1 contra 1, la IA avanzada le ganó 30 veces a la principiante. Tiempo máximo por jugada medido: principiante ~15 ms, intermedio ~5 ms, avanzado ~0.2 s, experto ~0.9 s (límite de búsqueda de 450 ms por cálculo).

## Las 20 pruebas obligatorias del prompt
| # | Prueba | Estado | Evidencia |
|---|---|---|---|
| 1 | Generación exacta de 106 fichas | ✔ Automatizada | engine.test.ts §1 |
| 2 | Reparto sin duplicados | ✔ Automatizada | engine §2, integridad verificada en cada jugada de cada simulación |
| 3 | Apertura de 30 puntos | ✔ Automatizada | engine §3, tutorial en navegador |
| 4 | Validación de grupos | ✔ Automatizada | engine §4 |
| 5 | Validación de escaleras | ✔ Automatizada | engine §5 |
| 6 | Sustitución de comodines | ✔ Automatizada | engine §6 (recuperar y reutilizar en el mismo turno; prohibido quedárselo) |
| 7 | Reorganización de la mesa | ✔ Automatizada | engine §7, IA avanzada que divide escaleras |
| 8 | Restauración de turnos inválidos | ✔ Automatizada | engine §8, servidor (rechazo devuelve estado), navegador (deshacer) |
| 9 | Agotamiento del pozo | ✔ Automatizada | engine §9 (bloqueo y puntuación) |
| 10 | Finalización y puntuación | ✔ Automatizada | engine §10 (individual, rondas, equipos) |
| 11 | Desconexión y reconexión | ✔ Automatizada | servidor (asiento y atril conservados; IA tras gracia), navegador (recargar vuelve a la partida) |
| 12 | Partidas simultáneas | ✔ Automatizada | 8 salas en paralelo en un proceso |
| 14b | Validación en cadena de EKOKIIN | ✔ Realizada | ABI, bytecode, holders y transferencias consultados en TronGrid y TronScan (ver WEB3.md) |
| KYC | Verificación de identidad con Sumsub | ◐ Parcial | Flujo completo probado contra un Sumsub simulado que valida las firmas como el real; falta probar con claves Sandbox reales |
| 13 | Conexión TronLink | ◐ Parcial | Probada con un TronLink simulado inyectado igual que la extensión. Falta probar con la extensión real y la app móvil. |
| 14 | Lectura del contrato EKOKIIN | ◐ Parcial | Datos verificados en TronScan; dirección y unidades probadas. La red de desarrollo bloqueaba TronGrid: falta la lectura en cadena real desde el servidor desplegado. |
| 15 | Stripe en sandbox | ◐ Parcial | Firma de webhooks, anti-replay, idempotencia, verificación de monto, reembolso y bloqueo de claves live probados con eventos firmados localmente. Falta crear una sesión real con claves `sk_test_` (no hay cuenta configurada). |
| 16 | Seguridad y control de accesos | ✔ Automatizada | Tokens falsificados, roles, bloqueo, límites de ritmo, chat, admin |
| 17 | Rendimiento móvil | ◐ Parcial | Tiempos de IA medidos; partidas completas en emulación de iPhone y Android sin errores. Falta perfilar en teléfonos reales de gama baja. |
| 18 | Compatibilidad de navegadores | ◐ Parcial | Chromium con perfiles de iPhone, Android y Windows/Edge. No se probó WebKit (Safari real) ni Firefox. |
| 19 | Simulación de contratos económicos solo en testnet | ◐ Parcial | Simulador de custodia probado (invariante contable, límites, autoexclusión, reembolsos). No desplegado en TRON Nile. |
| 20 | Recuperación ante fallos del servidor | ✔ Automatizada | Se detiene el servidor a mitad de partida, arranca uno nuevo con la misma base y los jugadores la terminan |

## Criterios de aceptación
| Criterio | Estado |
|---|---|
| Abrir en navegador y comenzar partida gratuita | ✔ |
| IA completa partidas enteras respetando reglas | ✔ (0 jugadas ilegales en todas las simulaciones) |
| Cuatro jugadores desde dispositivos diferentes | ✔ (4 conexiones WebSocket independientes; en navegador, Android + Windows + IA) |
| Modo equipos funciona | ✔ |
| Reconexión de jugadores | ✔ |
| Puntuaciones correctas | ✔ |
| Diseño en iPhone, Android y computadora | ✔ en emulación; pendiente ronda en hardware real |
| TronLink conecta y consulta EKOKIIN | ◐ con TronLink simulado |
| Stripe en modo de prueba | ◐ lógica probada; falta cuenta Stripe de prueba |
| Panel administrativo con datos reales | ✔ |
| Tests críticos aprobados | ✔ |
| Apuestas deshabilitadas | ✔ |

## Diferencias con la arquitectura sugerida
El entorno de desarrollo no tenía acceso al registro de npm, así que el proyecto se construyó con los componentes disponibles y sin dependencias pesadas. La arquitectura es modular (motor independiente de la interfaz y del transporte), de modo que estos componentes pueden sustituirse sin reescribir el juego:

| Sugerido | Implementado | Motivo / impacto |
|---|---|---|
| Next.js + React + Tailwind | TypeScript sin framework + CSS propio, empaquetado con esbuild (198 KB en total) | Carga rápida en móviles. Migrable a React si se desea. |
| PixiJS | DOM + CSS con transformaciones | Fichas accesibles por teclado y lector de pantalla, arrastre táctil probado. |
| NestJS + Socket.IO | Node `http` + `ws` (WebSocket estándar) | Mismas funciones: salas, reconexión, latido, límites. |
| PostgreSQL + Redis | SQLite integrado de Node (`node:sqlite`) | Suficiente para un servidor. Esquema PostgreSQL listo en `db/migrations`; **adaptador pendiente**. Redis solo haría falta con varios servidores. |
| Docker / CI | Dockerfile, docker-compose (con HTTPS y respaldos) y GitHub Actions escritos | **No se construyeron aquí** (sin demonio de Docker). |

## Pendientes antes del lanzamiento
1. Primera construcción con Docker en el servidor y despliegue con HTTPS.
2. Ronda manual en iPhone (Safari) y Android físicos, e instalación como app.
3. Lectura en cadena de EKOKIIN desde el servidor y revisión del código del contrato.
4. Claves de prueba de Stripe y una compra de punta a punta.
5. Adaptador PostgreSQL si se va a operar con varios servidores.
6. Aviso de privacidad y términos de uso.

## Detalle de pruebas unitarias y de integración
```
▶ 16. Autenticación y control de accesos
  ✔ registro, login, invitado y perfil
  ✔ tokens falsificados o alterados se rechazan
  ✔ panel admin: 403 para jugadores, datos reales para admin
  ✔ rate limiting de intentos de acceso
  ✔ cuerpo excesivo y JSON inválido
✔ 16. Autenticación y control de accesos
▶ Multijugador en tiempo real
  ✔ 4 jugadores en dispositivos distintos completan una partida real
  ✔ modo equipos 2 vs 2
  ✔ jugadas inválidas, duplicadas y fuera de turno se rechazan y restauran
  ✔ 11. desconexión y reconexión conservan el asiento y el atril
  ✔ si no regresa a tiempo, la IA lo reemplaza y la partida termina
  ✔ 12. partidas simultáneas (8 salas en paralelo)
  ✔ emparejamiento automático y relleno con IA
  ✔ chat moderado y emoticones
✔ Multijugador en tiempo real
▶ 20. Recuperación ante fallos del servidor
  ✔ una partida en curso sobrevive a un reinicio del servidor
✔ 20. Recuperación ante fallos del servidor
▶ Chat, auditoría y clasificación
  ✔ moderación
  ✔ registro de auditoría encadenado detecta alteraciones
  ✔ Elo: el ganador sube y el perdedor baja
✔ Chat, auditoría y clasificación
▶ 15. Stripe (modo prueba, firmas e idempotencia)
  ✔ verificación de firma
  ✔ webhook concede el cosmético una sola vez y el reembolso lo retira
  ✔ monto alterado no concede el producto
  ✔ claves live bloqueadas sin aprobación; sin clave no hay checkout
✔ 15. Stripe (modo prueba, firmas e idempotencia)
▶ 14. Web3 EKOKIIN
  ✔ dirección del contrato válida (Base58Check)
  ✔ conversión de unidades con 18 decimales
  ✔ API de token responde con datos verificados aunque la red no esté disponible
✔ 14. Web3 EKOKIIN
▶ 8/19. Módulo económico bloqueado y simulador en testnet
  ✔ bloqueado por defecto
  ✔ la variable de entorno sola no basta; aprobaciones incompletas tampoco
  ✔ simulador de custodia: depósitos, liquidación, comisión e invariante contable
  ✔ simulador: límites, autoexclusión y elegibilidad
  ✔ API pública informa bloqueo
✔ 8/19. Módulo económico bloqueado y simulador en testnet
▶ Torneos, amigos y clasificación
  ✔ torneo de 4 se completa (ausentes reemplazados por IA)
  ✔ amigos e invitaciones
  ✔ clasificación mundial e historial tras una partida pública
✔ Torneos, amigos y clasificación
▶ CORS para apps instaladas
  ✔ la API acepta solicitudes desde otro origen (app de Windows) y responde preflight
✔ CORS para apps instaladas
▶ Edad y términos
  ✔ la aceptación se guarda en la cuenta, se audita y aparece en métricas
✔ Edad y términos
▶ KYC con Sumsub
  ✔ firma de solicitudes según la especificación de Sumsub
  ✔ sin claves de Sumsub la verificación aparece como no disponible
  ✔ flujo completo: inicio, token de un solo uso, webhook aprobado y elegibilidad
  ✔ rechazo con corrección, consulta directa y rechazo final
  ✔ la página de verificación permite el SDK de Sumsub en su política de seguridad
✔ KYC con Sumsub
▶ IA
  ✔ encuentra la apertura con reorganización mínima
  ✔ reorganiza la mesa para colocar fichas (avanzado)
  ✔ la IA no recibe información oculta (vista sin atriles ajenos)
  ✔ sugerencia para principiantes
  ✔ partidas completas IA principiante (4 jugadores)
  ✔ partidas completas IA intermedio (4 jugadores)
  ✔ partidas completas IA avanzado (4 jugadores)
  ✔ partidas completas IA experto (4 jugadores)
  ✔ partida completa por equipos 2 vs 2
  ✔ la IA avanzada gana más que la principiante (30 partidas 1 vs 1)
✔ IA
▶ 1. Generación de fichas
  ✔ exactamente 106 fichas con ids únicos e inmutables
  ✔ 4 colores × 13 números × 2 copias + 2 comodines
✔ 1. Generación de fichas
▶ 2. Reparto
  ✔ 14 fichas por jugador, sin duplicados, resto en el pozo
  ✔ el pozo se baraja (CSPRNG): dos repartos distintos
  ✔ la vista de un jugador no contiene atriles ajenos ni el pozo
✔ 2. Reparto
▶ 3. Apertura de 30 puntos
  ✔ rechaza apertura de 29 y acepta de 30
  ✔ varias combinaciones suman para la apertura
  ✔ antes de abrir no se puede tocar la mesa
✔ 3. Apertura de 30 puntos
▶ 4. Grupos
  ✔ válidos
  ✔ inválidos
✔ 4. Grupos
▶ 5. Escaleras
  ✔ válidas
  ✔ inválidas
✔ 5. Escaleras
▶ 6. Comodines
  ✔ sustituyen en grupos y escaleras
  ✔ comodín extremo va arriba; si no cabe, abajo
  ✔ el comodín cuenta su valor para la apertura
  ✔ sustitución: recuperar el comodín de la mesa y usarlo en el mismo turno
  ✔ el comodín recuperado no puede quedarse en el atril
✔ 6. Comodines
▶ 7. Reorganización de la mesa
  ✔ dividir una escalera e insertar fichas
  ✔ no se puede colocar una ficha ajena
  ✔ no se acepta duplicar fichas
  ✔ formato malicioso rechazado
  ✔ turno equivocado rechazado
✔ 7. Reorganización de la mesa
▶ 8. Restauración ante jugadas inválidas
  ✔ una jugada inválida no altera el estado
  ✔ tiempo agotado: roba penalización y pasa el turno
✔ 8. Restauración ante jugadas inválidas
▶ 9. Agotamiento del pozo y bloqueo
  ✔ robar con pozo vacío pasa; todos pasan → ronda bloqueada
  ✔ robar normal toma una ficha del pozo
✔ 9. Agotamiento del pozo y bloqueo
▶ 10. Finalización y puntuación
  ✔ quedarse sin fichas termina la ronda; comodín resta 30
  ✔ varias rondas acumulan marcador
  ✔ equipos: gana el equipo del que cierra; el compañero no resta
  ✔ equipos requiere 4 jugadores
  ✔ scoreRound directo con pozo intacto
✔ 10. Finalización y puntuación
▶ Abandono
  ✔ un bot reemplaza al jugador y conserva su atril
✔ Abandono
✔ validatePlay no requiere estado mutable
```

## Detalle de pruebas en navegador
```
✔ iPhone 13: pide edad y aceptación de términos (Continuar bloqueado hasta aceptar)
✔ iPhone 13: ofrece tutorial en la primera visita
✔ iPhone 13: menú inicial completo
✔ iPhone 13: manifiesto PWA enlazado
✔ iPhone 13: reparto de 14 fichas — 14
✔ iPhone 13: combinación inválida marcada en rojo
✔ iPhone 13: no permite terminar con jugada inválida
✔ iPhone 13: deshacer devuelve las fichas al atril
✔ iPhone 13: arrastrar y soltar coloca la ficha en la mesa
✔ iPhone 13: completa turnos contra la IA — 6 turnos
✔ iPhone 13: sin desbordamiento horizontal — 0px
✔ iPhone 13: sin errores de JavaScript
✔ Pixel 7 (Android): pide edad y aceptación de términos (Continuar bloqueado hasta aceptar)
✔ Pixel 7 (Android): ofrece tutorial en la primera visita
✔ Pixel 7 (Android): menú inicial completo
✔ Pixel 7 (Android): manifiesto PWA enlazado
✔ Pixel 7 (Android): reparto de 14 fichas — 14
✔ Pixel 7 (Android): combinación inválida marcada en rojo
✔ Pixel 7 (Android): no permite terminar con jugada inválida
✔ Pixel 7 (Android): deshacer devuelve las fichas al atril
✔ Pixel 7 (Android): arrastrar y soltar coloca la ficha en la mesa
✔ Pixel 7 (Android): completa turnos contra la IA — 6 turnos
✔ Pixel 7 (Android): sin desbordamiento horizontal — 0px
✔ Pixel 7 (Android): sin errores de JavaScript
✔ Windows (Edge, 1366×768): pide edad y aceptación de términos (Continuar bloqueado hasta aceptar)
✔ Windows (Edge, 1366×768): ofrece tutorial en la primera visita
✔ Windows (Edge, 1366×768): menú inicial completo
✔ Windows (Edge, 1366×768): manifiesto PWA enlazado
✔ Windows (Edge, 1366×768): reparto de 14 fichas — 14
✔ Windows (Edge, 1366×768): combinación inválida marcada en rojo
✔ Windows (Edge, 1366×768): no permite terminar con jugada inválida
✔ Windows (Edge, 1366×768): deshacer devuelve las fichas al atril
✔ Windows (Edge, 1366×768): arrastrar y soltar coloca la ficha en la mesa
✔ Windows (Edge, 1366×768): completa turnos contra la IA — 6 turnos
✔ Windows (Edge, 1366×768): sin desbordamiento horizontal — 0px
✔ Windows (Edge, 1366×768): sin errores de JavaScript
✔ Tutorial guiado: escalera, grupo y apertura de 54 puntos
✔ Multijugador: sala privada creada con código — CKNBYU
✔ Multijugador: ambos dispositivos reciben su atril
✔ Multijugador: atriles distintos y privados
✔ Multijugador: turnos sincronizados entre dispositivos — 4 jugadas
✔ Multijugador: al recargar, el jugador vuelve a su partida
✔ Edad: un menor no puede entrar a Web3
✔ Web3: muestra la revisión del contrato
✔ Términos: sección de lo que conlleva apostar
✔ Web3: detecta ausencia de TronLink y explica cómo instalarlo
✔ Web3: muestra dirección abreviada y saldo leído del contrato — 2 EKOKIIN
✔ Web3: advierte red incorrecta (Nile)
✔ Admin: cuenta administradora creada
✔ Admin: panel con datos reales
✔ KYC: abre la página de verificación con enlace de un solo uso — el código se borra de la barra de direcciones
✔ KYC: exige consentimiento expreso antes de iniciar
✔ KYC: lanza el SDK de Sumsub con el token del servidor
✔ KYC: confirma el envío al terminar
✔ KYC: el webhook firmado de Sumsub se acepta
✔ KYC: el perfil muestra la identidad verificada
✔ KYC: sin errores de JavaScript
```
