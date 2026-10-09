/** Offline contract only. Shape validation is never target/provenance verification. */
export const PINS = Object.freeze({
  parentSha: 'c4e817f3fafa7115dee23f1b10d70be1bda4be2f',
  migration: '20261009151935_public_lead_admission_v1.sql',
  // SHA-256 of Git blob / LF-normalized SQL, not Windows CRLF checkout bytes.
  migrationSha256: 'bb76c753d3dcbc51e3ea81bb474a60a99da64809e06b6b163f549282afe4967c',
  policySourceSha256: '85cba6292d2d0bc5e82c1c2777a3dfa23b2b193ee8904639bf0d0717e9961978',
  policyVersion: 'ru-privacy-20261009-v1',
});
export type Isolation = 'READ COMMITTED' | 'REPEATABLE READ';
export type EvidenceState = 'PLAN_ONLY' | 'UNIT_CONTRACT_PASS' | 'POSTGRES_STATIC_ONLY' |
  'ISOLATED_ACCEPTED' | 'BLOCKED' | 'RECOVERY_REQUIRED' | 'PRODUCTION_RECEIPT';
const specs: Array<[string, Isolation | null, string]> = [
  ['same-rc', 'READ COMMITTED', 'Concurrent same canonical HMAC: one CRM row, one replay, same UUID'],
  ['same-rr', 'REPEATABLE READ', 'Stale snapshot raises 40001; whole-transaction retry replays'],
  ['different-rc', 'READ COMMITTED', 'Same contact, different payloads: distinct CRM/receipts'],
  ['different-rr', 'REPEATABLE READ', 'Different payload stale snapshot retries once after 40001'],
  ['global-quota-rc', 'READ COMMITTED', '149 seeds + two contenders: exactly 150 accepted, loser 429 contract'],
  ['global-quota-rr', 'REPEATABLE READ', 'Global last slot with serialization and full retry'],
  ['contact-quota-rc', 'READ COMMITTED', 'Two seeds + contenders for one contact: exactly three accepted'],
  ['contact-quota-rr', 'REPEATABLE READ', 'Contact last slot under stale repeatable snapshot'],
  ['rollback', null, 'Admission then ROLLBACK leaves no CRM, receipt or counter increment'],
  ['pre-commit-disconnect', null, 'Disconnect open transaction; observer proves rollback before retry'],
  ['commit-ack-loss', null, 'Custodian severs wire after COMMIT sent; durable journal reconciles exact UUID'],
  ['restart-replay', null, 'Separate OS process replays committed receipt, no process memory dependency'],
  ['lock-timeout', null, 'Contender blocked by singleton owner times out; rollback then retry'],
  ['deadlock', null, 'Two owned sessions invert namespaced advisory locks; 40P01 victim rolls back then admission retries'],
  ['missing-rpc', null, 'Missing function yields 42883 without writes; no fallback'],
  ['consent-persistence', null, 'CRM + consent durable after reconnect, exact policy/content/source hash'],
  ['role-denial', null, 'Actual anon/authenticated sessions cannot execute RPC or read private tables'],
  ['clock-watermark', null, 'Forward watermark then lower time cannot weaken quotas; rollback fixture'],
  ['utc-boundary', null, 'Independent clock controller crosses UTC midnight with admission quota retained'],
  ['capacity', null, '100000 watermark fails closed, all modifications rolled back'],
  ['key-mismatch', null, 'Changed HMAC commitment rejected before CRM/receipt writes'],
  ['missing-consent', null, 'Missing/false consent and incorrect policy pin fail without writes'],
  ['crm-receipt-atomicity', null, 'Custodian fault between CRM and receipt causes whole transaction rollback'],
  ['exact-cleanup', null, 'Reattest target, delete only journaled UUID+digest pairs, count/absence verified'],
];
export const SCENARIOS = Object.freeze(specs.map(([id, isolation, expectation]) =>
  Object.freeze({ id, isolation, expectation, evidence: 'REAL_ONLY' as const, required: true as const })));
export function createPlan() {
  return {
    schemaVersion: 'strigunov.postgres-acceptance.v1', state: 'PLAN_ONLY' as EvidenceState,
    verdict: 'BLOCK' as const, databaseAccepted: false, target: null,
    postgresCalls: 0, cleanupCalls: 0, productionReceiptSupported: false,
    pins: { ...PINS }, scenarios: SCENARIOS.map(s => ({ id: s.id, status: 'NOT_RUN' })),
  };
}
/** JSON text only: object getters, proxy traps and callbacks are never inspected. */
export function validateContract(input: unknown) {
  const blocked = { state: 'BLOCKED', databaseAccepted: false } as const;
  if (typeof input !== 'string' || input.length > 32_768) return blocked;
  try {
    return JSON.stringify(JSON.parse(input)) === JSON.stringify(createPlan())
      ? { state: 'UNIT_CONTRACT_PASS', databaseAccepted: false } as const : blocked;
  } catch { return blocked; }
}
export function safeFailure(error: unknown): string {
  // Only called with internally caught driver errors. Do not serialize error messages/stacks.
  const codes: Record<string, string> = { '40001': 'SERIALIZATION', '40P01': 'DEADLOCK',
    '55P03': 'LOCK_TIMEOUT', '57014': 'QUERY_TIMEOUT', '42501': 'PRIVILEGE_DENIED',
    'P0001': 'ADMISSION_REJECTED', '42883': 'MISSING_RPC', '42P01': 'MISSING_RELATION' };
  try {
    const d = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'code') : undefined;
    return d && typeof d.value === 'string' ? codes[d.value] ?? 'DATABASE_FAILURE' : 'DATABASE_FAILURE';
  } catch { return 'DATABASE_FAILURE'; }
}
export type JournalPhase = 'INTENT' | 'IDENTIFIED' | 'COMMITTED' | 'COMMIT_UNKNOWN' |
  'UNKNOWN' | 'ROLLED_BACK' | 'CLEANED';
export interface Ownership { phase: JournalPhase; crmId: string | null }
export function cleanupDecision(records: readonly Ownership[]) {
  if (records.some(r => !['COMMITTED', 'ROLLED_BACK', 'CLEANED'].includes(r.phase) ||
    (r.phase === 'COMMITTED' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r.crmId ?? ''))))
    return 'RECOVERY_REQUIRED' as const;
  return records.some(r => r.phase === 'COMMITTED') ? 'EXACT_IDS_ONLY' as const : 'NOTHING_TO_CLEAN' as const;
}
