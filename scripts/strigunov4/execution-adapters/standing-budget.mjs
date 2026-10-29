/**
 * Source-only, non-authorizing durable budget reservation for the existing
 * Strigunov Publisher. Host MUST independently verify owner signature,
 * current revocation, exact scope, CI/review and expiry before entering this
 * adapter; nothing here grants an operation or performs a remote effect.
 *
 * The caller invokes reserve() inside store.execute's existing execution.lock
 * with that very call's `ledger` object, after its durable IN_FLIGHT_OR_CRASHED
 * brake and before the existing Publisher INTENT + external request. All claims
 * are stored on that SAME autopilot-ledger.json under the SAME atomicJson lock.
 * No separate ledger, writer, scheduler, capability or automatic replay.
 */
import fs from 'node:fs/promises';
import {atomicJson, must} from './state.mjs';

const HEX64 = /^[0-9a-f]{64}$/;
const HEX40 = /^[0-9a-f]{40}$/;
const ID = /^[a-z0-9][a-z0-9-]{0,95}$/;
const REPO = 'ASI-integration/asi-landing';
const TIME_LIMIT = 14 * 86400000;
const MAX_ENVELOPES = 16;
const MAX_CLAIMS = 256;
const READ = 'github-read';
const WRITES = new Set(['create-tree', 'create-commit', 'create-branch', 'create-draft-pr']);
const max = (x, limit) => Number.isSafeInteger(x) && x > 0 && x <= limit;
const h64 = x => typeof x === 'string' && HEX64.test(x);
const h40 = x => typeof x === 'string' && HEX40.test(x);
const ident = x => typeof x === 'string' && ID.test(x);
const deny = reason => Object.freeze({status:'DENIED', reason, reserved:false});

function validateEnvelope(e, at) {
  if (!e || e.schema !== 'asi.release-envelope.proposal.v1' || e.repo !== REPO ||
      e.environment !== 'beget-staging' || e.target !== 'pqukibofpo' ||
      e.action !== 'source' || !h64(e.envelopeDigest) ||
      !h64(e.securityDigest) || !h64(e.policyDigest) ||
      !Number.isSafeInteger(e.notBefore) || !Number.isSafeInteger(e.expiresAt) ||
      e.notBefore > at || at >= e.expiresAt || e.expiresAt <= e.notBefore ||
      e.expiresAt - e.notBefore > TIME_LIMIT || e.paidApiUsd !== 0 ||
      !max(e.maxOperations, MAX_CLAIMS) || !max(e.maxRequests, MAX_CLAIMS) ||
      !max(e.maxWrites, 64) || e.maxWrites > e.maxRequests ||
      e.maxWrites > e.maxOperations) return 'BUDGET_ENVELOPE_SCOPE';
  return null;
}

function validateEffect(e, effect) {
  if (!effect || !ident(effect.effectId) || !ident(effect.taskId) ||
      !h40(effect.headSha) ||
      typeof effect.kind !== 'string' || (effect.kind !== READ && !WRITES.has(effect.kind)) ||
      effect.envelopeDigest !== e.envelopeDigest || effect.repo !== e.repo ||
      effect.environment !== e.environment || effect.target !== e.target ||
      effect.action !== e.action) return 'BUDGET_EFFECT_SCOPE';
  return null;
}

function exactScope(e) {
  return {
    digest:e.envelopeDigest, securityDigest:e.securityDigest, policyDigest:e.policyDigest,
    repo:e.repo, environment:e.environment, target:e.target, action:e.action,
    notBefore:e.notBefore, expiresAt:e.expiresAt, maxOperations:e.maxOperations,
    maxRequests:e.maxRequests, maxWrites:e.maxWrites,
  };
}
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);

/** One instance per existing store.execute transaction; no effects are run. */
export function createStandingPublisherBudget({store, ledger, clock=Date.now}={}) {
  must(typeof store?.file === 'function' && ledger && typeof ledger === 'object' &&
    !Array.isArray(ledger) && typeof clock === 'function', 'BUDGET_HOST_REQUIRED');
  let tail = Promise.resolve(), poisoned = false;
  function enqueue(fn) {
    const next = tail.then(async () => {
      if (poisoned) return deny('BUDGET_UNCERTAIN_STORAGE');
      try { return await fn(); }
      catch (e) { poisoned = true; throw e; }
    });
    // Keep the serialized lane alive solely to deliver a fixed DENY once poisoned.
    tail = next.then(() => {}, () => {});
    return next;
  }
  return Object.freeze({reserve({envelope, effect}={}) {
    return enqueue(async () => {
      const at = clock();
      if (!Number.isSafeInteger(at) || at < 0) return deny('BUDGET_CLOCK');
      const eReason = validateEnvelope(envelope, at);
      if (eReason) return deny(eReason);
      const effectReason = validateEffect(envelope,effect);
      if (effectReason) return deny(effectReason);
      // A stale/failed transaction, or a second process without the shared lock,
      // must never consume budget or reach the remote effect.
      if (ledger.mode !== 'FAILED_LOCKED' || ledger.reason !== 'IN_FLIGHT_OR_CRASHED')
        return deny('BUDGET_NOT_IN_ACTIVE_TRANSACTION');
      const lock = await fs.lstat(store.file('execution.lock')).catch(x => {
        if (x.code === 'ENOENT') return null;
        throw x;
      });
      if (!lock?.isDirectory() || lock.isSymbolicLink()) return deny('BUDGET_LOCK_ABSENT');
      must(ledger.schemaVersion === 'asi.execution-adapters.v1' && ledger.jobs &&
        typeof ledger.jobs === 'object' && !Array.isArray(ledger.jobs), 'BUDGET_LEDGER_INVALID');
      const root = ledger.standingDelegationBudget;
      if (root !== undefined) must(root && root.version === 1 && root.envelopes &&
        typeof root.envelopes === 'object' && !Array.isArray(root.envelopes) &&
        Object.keys(root.envelopes).length <= MAX_ENVELOPES, 'BUDGET_LEDGER_INVALID');
      const budget = root || {version:1,envelopes:{}};
      const current = budget.envelopes[envelope.envelopeDigest];
      const scope = exactScope(envelope);
      if (current) {
        must(current.scope && same(current.scope,scope) && Array.isArray(current.claims) &&
          current.claims.length <= MAX_CLAIMS &&
          Number.isSafeInteger(current.lastObservedAt) &&
          Number.isSafeInteger(current.requests) && current.requests >= 0 &&
          Number.isSafeInteger(current.writes) && current.writes >= 0 &&
          Number.isSafeInteger(current.operations) && current.operations >= 0 &&
          current.requests <= scope.maxRequests && current.writes <= scope.maxWrites &&
          current.operations <= scope.maxOperations &&
          current.claims.every(c => c && ident(c.effectId) && ident(c.taskId) &&
            h40(c.headSha) && (c.kind === READ || WRITES.has(c.kind)) &&
            Number.isSafeInteger(c.reservedAt) && c.reservedAt >= scope.notBefore &&
            c.reservedAt <= current.lastObservedAt && c.phase === 'RESERVED' &&
            c.publicationJournal === `publication-${c.taskId}.json`) &&
          current.requests === current.claims.length &&
          current.writes === current.claims.filter(c => c.kind !== READ).length &&
          current.operations === current.claims.length &&
          new Set(current.claims.map(c => c.effectId)).size === current.claims.length,
          'BUDGET_LEDGER_INVALID');
        if (at < current.lastObservedAt) return deny('BUDGET_CLOCK_REGRESSION');
        if (current.claims.some(c=>c.effectId===effect.effectId))
          return deny('BUDGET_REPLAY_OR_UNKNOWN');
      }
      if (!current && Object.keys(budget.envelopes).length >= MAX_ENVELOPES)
        return deny('BUDGET_HISTORY_FULL');
      const before = current || {scope, lastObservedAt:at, operations:0, requests:0, writes:0, claims:[]};
      const write = effect.kind === READ ? 0 : 1;
      if (before.operations + 1 > scope.maxOperations ||
          before.requests + 1 > scope.maxRequests || before.writes + write > scope.maxWrites ||
          before.claims.length >= MAX_CLAIMS) return deny('BUDGET_EXHAUSTED');
      // A reservation is irreversible, even when the API call fails or times out.
      // Existing publication-${taskId}.json INTENT and state.execute FAILED_LOCKED
      // provide remote-result evidence and the crash brake; neither is reset here.
      const claim = {effectId:effect.effectId,taskId:effect.taskId,headSha:effect.headSha,
        kind:effect.kind, reservedAt:at, phase:'RESERVED',
        publicationJournal:`publication-${effect.taskId}.json`};
      const updated = {...before,lastObservedAt:at,operations:before.operations + 1,
        requests:before.requests + 1,writes:before.writes + write,
        claims:[...before.claims,claim]};
      const next = {version:1,envelopes:{...budget.envelopes,[scope.digest]:updated}};
      // Exactly one durable commit using the existing atomic file writer.
      // Do not mutate the shared in-memory ledger before fsync success.
      await atomicJson(store.file('autopilot-ledger.json'),{...ledger,standingDelegationBudget:next});
      ledger.standingDelegationBudget = next;
      return Object.freeze({status:'RESERVED',reserved:true,envelopeDigest:scope.digest,
        effectId:claim.effectId,taskId:claim.taskId,headSha:claim.headSha,
        kind:claim.kind,operations:updated.operations,requests:updated.requests,
        writes:updated.writes});
    });
  }});
}
