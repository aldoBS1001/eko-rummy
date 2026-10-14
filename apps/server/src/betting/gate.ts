// Candado del módulo de partidas con participación económica.
// DESACTIVADO POR DEFECTO. No se puede activar desde el panel ni desde el cliente.
// Para habilitarlo se requieren, simultáneamente:
//   1) Variable de entorno BETTING_ENABLED=true en el servidor (acceso a infraestructura).
//   2) Archivo de aprobaciones (COMPLIANCE_FILE) con TODAS las aprobaciones listadas abajo,
//      cada una con responsable, fecha y referencia documental.
//   3) Para TRON Mainnet, además: auditoría independiente del contrato y aprobación de despliegue.
// Aun habilitado, este repositorio solo incluye el simulador (sin dinero real). La liquidación
// real queda pendiente de implementar tras auditoría.

import { readFileSync, existsSync } from 'node:fs';
import type { Config } from '../config.ts';

export const REQUIRED_APPROVALS = [
  { key: 'legal_jurisdictions', label: 'Análisis jurídico de jurisdicciones habilitadas' },
  { key: 'gaming_permits', label: 'Permisos regulatorios de juegos con apuesta (p. ej. SEGOB en México)' },
  { key: 'age_location_verification', label: 'Verificación de edad y ubicación' },
  { key: 'kyc_aml', label: 'Controles KYC/AML' },
  { key: 'financial_providers', label: 'Autorización de proveedores financieros' },
  { key: 'smart_contract_audit', label: 'Auditoría independiente de contratos inteligentes' },
  { key: 'responsible_gaming', label: 'Políticas de juego responsable' },
  { key: 'disputes_refunds', label: 'Procedimientos de disputas, reembolsos y resolución' },
  { key: 'operator_approval', label: 'Aprobación explícita del operador para producción' },
] as const;

export interface GateStatus {
  enabled: boolean;
  envFlag: boolean;
  approvals: { key: string; label: string; ok: boolean; approver?: string; date?: string; reference?: string }[];
  mainnetAllowed: boolean;
  reasons: string[];
}

export function bettingStatus(cfg: Config): GateStatus {
  const reasons: string[] = [];
  let file: Record<string, any> = {};
  if (existsSync(cfg.complianceFile)) {
    try { file = JSON.parse(readFileSync(cfg.complianceFile, 'utf8')); }
    catch { reasons.push('Archivo de aprobaciones ilegible'); }
  } else reasons.push('No existe archivo de aprobaciones de cumplimiento');
  const approvals = REQUIRED_APPROVALS.map(a => {
    const e = file[a.key];
    const ok = !!e && e.approved === true && typeof e.approver === 'string' && e.approver.length > 2 && typeof e.date === 'string' && typeof e.reference === 'string' && e.reference.length > 2;
    if (!ok) reasons.push(`Falta: ${a.label}`);
    return { key: a.key, label: a.label, ok, approver: e?.approver, date: e?.date, reference: e?.reference };
  });
  if (!cfg.bettingEnabled) reasons.unshift('BETTING_ENABLED no está activo en el servidor');
  const allOk = approvals.every(a => a.ok);
  const mainnetAllowed = allOk && file.mainnet_deployment?.approved === true && cfg.tronNetwork === 'mainnet';
  return { enabled: cfg.bettingEnabled && allOk, envFlag: cfg.bettingEnabled, approvals, mainnetAllowed, reasons };
}

/** Lanza un error si alguien intenta usar funciones económicas sin todas las autorizaciones. */
export function assertBettingAllowed(cfg: Config) {
  const s = bettingStatus(cfg);
  if (!s.enabled) throw new Error(`Módulo económico bloqueado: ${s.reasons[0]}`);
}
