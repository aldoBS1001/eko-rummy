# Web3 y token EKOKIIN

## Verificación del contrato (14 de octubre de 2026)
Consulta a la API pública de TronScan (`apilist.tronscanapi.com/api/token_trc20?contract=…`):

| Dato | Valor |
|---|---|
| Nombre | EKO K'IIN Token |
| Símbolo | EKOKIIN |
| Estándar | TRC-20, TRON Mainnet |
| Contrato | `TMNKYEbXGJGFPaZXs8tBER6gMiRvjKtUiU` (checksum Base58 validado en pruebas) |
| Decimales | 18 |
| Suministro total | 100,000,000 EKOKIIN |
| Emisor | `TAguowZSZgJpLt3ZXYfFAbV5NktLzPcGqC` |
| Emisión | 26-sep-2026 |
| Holders | 10 |
| Precio de mercado | No reportado por TronScan |

## Validación en cadena (14 de octubre de 2026)
Fuentes: `wallet/getcontract` de TronGrid (ABI y bytecode desplegado) y las APIs públicas de TronScan (holders y transferencias).

| Comprobación | Resultado |
|---|---|
| Nombre interno del contrato | `EKOKiinTestToken` (el token se llama "EKO K'IIN Token", símbolo EKOKIIN) |
| Código fuente verificado en TronScan | **No** |
| Compilador | Solidity 0.8.20 (estilo OpenZeppelin con errores TRC20) |
| Funciones | `name`, `symbol`, `decimals`, `totalSupply`, `INITIAL_SUPPLY`, `balanceOf`, `allowance`, `transfer`, `approve`, `transferFrom` |
| Bytecode | El despachador tiene exactamente esos 10 selectores. No aparecen `mint`, `burn`, `pause`, `owner`/`transferOwnership` ni listas negras |
| Suministro | Fijo: 100,000,000 EKOKIIN acuñados en la creación (26-sep-2026) |
| Comisiones por transferencia | No tiene |
| Holders | 10. La suma de sus saldos da exactamente 100,000,000 (cuadra con el suministro) |
| Concentración | 50 % en `TNCyBh…P9LSE`, 29 % en `TUT6rB…7zmjg`, ~10 % en dos direcciones más, 0.9 % en el emisor |
| Transferencias | 16, todas confirmadas |
| Liquidez / precio de mercado | TronScan no reporta precio ni liquidez significativa |

**Conclusión técnica:** es un token TRC-20 estándar, de suministro fijo y sin funciones de administrador, por lo que nadie puede crear más, congelar cuentas ni cobrar comisiones. Pendiente recomendado: publicar y verificar el código fuente en TronScan (da confianza a usuarios y exchanges) y tomar en cuenta que el nombre interno del contrato dice "TestToken"; no se puede cambiar sin desplegar un contrato nuevo.

Nota: el análisis del bytecode se hizo a partir de la respuesta de la API leída con una herramienta de lectura web; conviene repetirlo con un script desde el servidor desplegado (`GET /api/web3/token`).

## Qué hace el juego
- **Conectar TronLink** (extensión en Chrome/Edge en Windows; navegador DApp de la app TronLink en iPhone y Android).
- Mostrar dirección abreviada, desconectar, detectar red incorrecta (avisa si no es Mainnet).
- Leer el saldo de EKOKIIN directamente del contrato (llamada de solo lectura).
- Historial de transferencias EKOKIIN vía TronGrid, con enlaces a TronScan.
- Enlaces externos a TronScan y SUN.io.
- Guardar en la cuenta únicamente la dirección pública.

## Qué no hace
- No pide, recibe ni guarda llaves privadas o frases semilla.
- No firma transacciones ni mueve fondos. No existe ninguna ruta del servidor que lo haga.
- No muestra ni promete precio o respaldo del token.
- El juego gratuito no depende de Web3 en absoluto.
