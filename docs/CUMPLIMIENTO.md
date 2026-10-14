# Informe de cumplimiento pendiente

Este documento no es asesoría legal. Resume lo que el software hace hoy y lo que falta resolver con abogados y autoridades antes de cualquier función con valor económico.

## Estado actual
| Área | Estado |
|---|---|
| Juego gratuito | Listo. Sin compras obligatorias, sin billetera, sin apuestas. |
| Tienda cosmética (Stripe) | Lista en modo de prueba. Producción requiere confirmar elegibilidad con Stripe, facturación (CFDI) y aviso de privacidad. |
| Web3 | Solo lectura. No custodia ni mueve fondos. |
| Edad y términos | Pantalla obligatoria de declaración de edad y aceptación de términos (versión registrada y auditada). Los menores no ven Web3. |
| KYC | Integrado con Sumsub (identificación + selfie, consentimiento expreso). Solo cuentas verificadas son elegibles para funciones económicas. Falta conectar las claves reales. |
| Partidas con valor económico | **Bloqueadas.** El código no incluye depósitos, retiros ni contratos en Mainnet. Solo existe un simulador sin valor real. |

## Cómo está bloqueado el módulo económico
El servidor lo considera habilitado solo si se cumplen **todas** estas condiciones a la vez:
1. `BETTING_ENABLED=true` en el servidor (acceso a infraestructura, no al panel).
2. Archivo `compliance/approvals.json` con cada aprobación de la lista siguiente marcada `approved: true`, con responsable, fecha y referencia documental.
3. Para Mainnet, además `mainnet_deployment` aprobado.

El panel administrativo solo muestra el estado; no puede activarlo. Aun habilitado, la liquidación real **no está implementada**: habría que escribir y auditar el contrato de custodia.

## Aprobaciones requeridas
| Clave | Requisito | Responsable sugerido |
|---|---|---|
| `legal_jurisdictions` | Análisis jurídico de jurisdicciones habilitadas. En México los juegos con apuesta requieren permiso de SEGOB (Ley Federal de Juegos y Sorteos y su Reglamento). | Abogado de juegos y sorteos |
| `gaming_permits` | Permisos regulatorios aplicables en cada jurisdicción | Abogado / operador con permiso |
| `age_location_verification` | Verificación de mayoría de edad y geolocalización | Proveedor KYC (p. ej. Sumsub) |
| `kyc_aml` | Controles KYC/AML; en México, avisos de actividades vulnerables (LFPIORPI) | Oficial de cumplimiento |
| `financial_providers` | Autorización de proveedores financieros y de activos virtuales | Legal / finanzas |
| `smart_contract_audit` | Auditoría independiente del contrato de custodia | Firma auditora |
| `responsible_gaming` | Políticas de juego responsable, límites y autoexclusión | Operador |
| `disputes_refunds` | Procedimientos de disputas, reembolsos y resolución | Operador / legal |
| `operator_approval` | Aprobación explícita del operador | Dirección de Business Shop |

## Simulador (validado con pruebas)
`apps/server/src/betting/escrowSim.ts` modela custodia con unidades ficticias: aceptación expresa de condiciones, elegibilidad (edad, KYC, jurisdicción), montos mínimos y máximos, límite diario, autoexclusión, depósito duplicado rechazado, liquidación individual y por equipos, comisión transparente, reembolso ante cancelación e invariante contable (no se crea ni destruye valor). No está desplegado en TRON Nile; ese es el siguiente paso técnico, ya con el contrato auditado.

## Otros pendientes legales
- Aviso de privacidad (LFPDPPP) y términos de uso.
- Revisión de las guías de App Store y Google Play sobre criptomonedas y juegos con dinero real antes de publicar en tiendas.
- Descripción del token sin promesas de rendimiento ni precio (el juego ya no muestra precio).
