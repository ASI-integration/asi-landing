/** Pure lease/journal transition model. VERIFIED here is always UNIT_ONLY, never authority. */
import { canonical, check, claimsFromText, clockValid, exact, object, parseCanonical, UUID } from './protocol';
import type { Claims, ObjectJson } from './protocol';

export type LeasePhase = 'ISSUED' | 'CLAIMED' | 'RUNNING' | 'STOPPING' | 'FINALIZING' |
  'VERIFIED' | 'BLOCKED' | 'RECOVERY_REQUIRED';
interface Pending extends ObjectJson {
  operationId: string; scenario: string; phase: string; crmId: string | null;
  receiptDigest: string | null; reservedRows: number;
}
export interface ModelState extends ObjectJson {
  authorityClass: 'UNIT_ONLY'; claims: Claims; phase: LeasePhase; lastAtMs: number; lastElapsedMs: number;
  startedElapsedMs: number | null; queries: number; writes: number; rows: number;
  operations: Pending[]; completedScenarios: string[]; cleanupIds: string[]; cleanupPending: boolean;
}
export function initialModelState(claimsText: unknown, now: number): string {
  const claims = claimsFromText(claimsText); check(clockValid(claims, now), 'AUTHORIZATION_TIME');
  const state: ModelState = { authorityClass: 'UNIT_ONLY', claims, phase: 'ISSUED', lastAtMs: now,
    lastElapsedMs: 0, startedElapsedMs: null, queries: 0, writes: 0, rows: 0,
    operations: [], completedScenarios: [], cleanupIds: [], cleanupPending: false };
  return canonical(state);
}
const BASE = ['op','atMs','elapsedMs','bootDigest'];
const EXTRA: Record<string, string[]> = {
  CLAIM: [], START: [], STOP: [], DRAIN: [], REVOKE: [], FINALIZE: [], VERIFY: [],
  INTENT: ['operationId','scenario','role','queries','writes','rows'],
  IDENTIFIED: ['operationId','crmId','receiptDigest'],
  COMMIT_UNKNOWN: ['operationId'], COMMIT_ACK: ['operationId'],
  UNKNOWN: ['operationId'], ROLLBACK_ACK: ['operationId'],
  SCENARIO_DONE: ['scenario'], CLEANUP_INTENT: ['crmIds'], CLEANUP_ACK: ['crmIds','deleted','remaining'],
};
function whole(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function uncertain(s: ModelState) {
  return s.cleanupPending || s.operations.some(o => ['INTENT','IDENTIFIED','COMMIT_UNKNOWN','UNKNOWN'].includes(o.phase));
}
export function reduceModel(stateText: unknown, eventText: unknown): string {
  const s = parseCanonical(stateText, 262144) as ModelState, e = parseCanonical(eventText, 8192);
  check(s.authorityClass === 'UNIT_ONLY'); // store reconstructs this state only by replay, never trusts caller snapshots
  const c = claimsFromText(canonical(object(s.claims)));
  check(typeof e.op === 'string' && Object.hasOwn(EXTRA, e.op)); exact(e, [...BASE, ...EXTRA[e.op]]);
  check(whole(e.atMs) && whole(e.elapsedMs));
  const active = s.phase !== 'ISSUED';
  const terminal = ['VERIFIED','BLOCKED','RECOVERY_REQUIRED'].includes(s.phase);
  check(!terminal, 'LEASE_TERMINAL');
  if (e.bootDigest !== c.hostBootDigest || e.atMs < s.lastAtMs || e.elapsedMs < s.lastElapsedMs ||
    Math.abs((e.atMs - s.lastAtMs) - (e.elapsedMs - s.lastElapsedMs)) > 2000) {
    s.phase = active ? 'RECOVERY_REQUIRED' : 'BLOCKED'; return canonical(s);
  }
  s.lastAtMs = e.atMs; s.lastElapsedMs = e.elapsedMs;
  if (!clockValid(c, e.atMs) || (s.startedElapsedMs !== null && e.elapsedMs - s.startedElapsedMs > c.maxDurationMs)) {
    s.phase = uncertain(s) ? 'RECOVERY_REQUIRED' : 'BLOCKED'; return canonical(s);
  }
  if (e.op === 'REVOKE') { s.phase = uncertain(s) ? 'RECOVERY_REQUIRED' : 'BLOCKED'; return canonical(s); }
  if (e.op === 'STOP') {
    s.phase = s.phase === 'ISSUED' ? 'BLOCKED' : 'STOPPING'; return canonical(s);
  }
  if (e.op === 'DRAIN') {
    check(s.phase === 'STOPPING', 'STOP_REQUIRED');
    s.phase = uncertain(s) ? 'RECOVERY_REQUIRED' : 'FINALIZING'; return canonical(s);
  }
  switch (e.op) {
    case 'CLAIM':
      check(s.phase === 'ISSUED', 'NONCE_REPLAY'); s.phase = 'CLAIMED'; break;
    case 'START':
      check(s.phase === 'CLAIMED'); s.phase = 'RUNNING'; s.startedElapsedMs = e.elapsedMs; break;
    case 'INTENT': {
      check(s.phase === 'RUNNING' && c.scenarios.includes(String(e.scenario)) && c.roles.includes(String(e.role)), 'SCOPE_INVALID');
      check(typeof e.operationId === 'string' && UUID.test(e.operationId) &&
        !s.operations.some(o => o.operationId === e.operationId), 'OPERATION_REPLAY');
      check(whole(e.queries) && e.queries > 0 && whole(e.writes) && e.writes > 0 && whole(e.rows) && e.rows <= 1);
      check(s.queries + e.queries <= c.maxQueries && s.writes + e.writes <= c.maxWrites &&
        s.rows + e.rows <= c.maxRows, 'BUDGET_EXCEEDED');
      s.queries += e.queries; s.writes += e.writes; s.rows += e.rows;
      s.operations.push({ operationId: e.operationId, scenario: String(e.scenario), phase: 'INTENT',
        crmId: null, receiptDigest: null, reservedRows: e.rows });
      break; // a real host would await durable journal acknowledgment before any action
    }
    case 'IDENTIFIED':
    case 'COMMIT_UNKNOWN':
    case 'COMMIT_ACK':
    case 'UNKNOWN':
    case 'ROLLBACK_ACK': {
      check(['RUNNING','STOPPING'].includes(s.phase)); // STOP may drain existing work, never begin another
      const item = s.operations.find(o => o.operationId === e.operationId); check(item, 'OPERATION_UNKNOWN');
      if (e.op === 'UNKNOWN') { item.phase = 'UNKNOWN'; s.phase = 'RECOVERY_REQUIRED'; break; }
      if (e.op === 'IDENTIFIED') {
        check(item.phase === 'INTENT' && typeof e.crmId === 'string' && UUID.test(e.crmId) &&
          typeof e.receiptDigest === 'string' && /^[a-f0-9]{64}$/.test(e.receiptDigest));
        check(!s.operations.some(o => o !== item && o.crmId === e.crmId), 'UUID_REUSE');
        item.crmId = e.crmId; item.receiptDigest = e.receiptDigest; item.phase = 'IDENTIFIED';
      } else if (e.op === 'COMMIT_UNKNOWN') {
        if (item.phase !== 'IDENTIFIED' || !item.crmId) { item.phase = 'UNKNOWN'; s.phase = 'RECOVERY_REQUIRED'; break; }
        item.phase = 'COMMIT_UNKNOWN';
      } else if (e.op === 'COMMIT_ACK') {
        check(item.phase === 'COMMIT_UNKNOWN' && item.crmId); item.phase = 'COMMITTED';
      } else {
        if (!['INTENT','IDENTIFIED'].includes(item.phase)) { s.phase = 'RECOVERY_REQUIRED'; break; }
        item.phase = 'ROLLED_BACK'; // only an actual host could attest an actual rollback
      }
      break;
    }
    case 'SCENARIO_DONE':
      check(s.phase === 'RUNNING' && c.scenarios.includes(String(e.scenario)) && !uncertain(s));
      check(!s.completedScenarios.includes(String(e.scenario)));
      s.completedScenarios.push(String(e.scenario)); s.completedScenarios.sort(); break;
    case 'FINALIZE':
      check(s.phase === 'RUNNING');
      s.phase = uncertain(s) ? 'RECOVERY_REQUIRED' : 'FINALIZING'; break;
    case 'CLEANUP_INTENT': {
      check(s.phase === 'FINALIZING' && !uncertain(s));
      const owned = s.operations.filter(o => o.phase === 'COMMITTED').map(o => o.crmId!).sort();
      check(owned.length > 0 && owned.length <= c.cleanupMaxRows && canonical(e.crmIds) === canonical(owned), 'CLEANUP_SCOPE');
      check(s.queries + 1 <= c.maxQueries && s.writes + owned.length <= c.maxWrites, 'BUDGET_EXCEEDED');
      s.queries++; s.writes += owned.length; s.cleanupIds = owned; s.cleanupPending = true; break;
    }
    case 'CLEANUP_ACK':
      check(s.phase === 'FINALIZING' && s.cleanupPending);
      if (canonical(e.crmIds) !== canonical(s.cleanupIds) || e.deleted !== s.cleanupIds.length || e.remaining !== 0) {
        s.phase = 'RECOVERY_REQUIRED'; break;
      }
      for (const item of s.operations.filter(o => s.cleanupIds.includes(o.crmId!))) item.phase = 'CLEANED';
      s.cleanupPending = false; break;
    case 'VERIFY':
      check(s.phase === 'FINALIZING' && !uncertain(s) &&
        s.operations.every(o => ['CLEANED','ROLLED_BACK'].includes(o.phase)) &&
        canonical(s.completedScenarios) === canonical(c.scenarios), 'EVIDENCE_INCOMPLETE');
      s.phase = 'VERIFIED'; break;
  }
  return canonical(s);
}
