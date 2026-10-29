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
import {createHash} from 'node:crypto';
import {atomicJson, must} from './state.mjs';
import * as githubReadonly from './github-readonly.mjs';

const HEX64 = /^[0-9a-f]{64}$/;
const HEX40 = /^[0-9a-f]{40}$/;
const ID = /^[a-z0-9][a-z0-9-]{0,95}$/;
const REPO = 'ASI-integration/asi-landing';
const TIME_LIMIT = 14 * 86400000;
const MAX_ENVELOPES = 16;
const MAX_CLAIMS = 256;
const READ = 'github-read';
const COMPILED_READ = 'github-compiled-read';
const isRead = kind => kind === READ || kind === COMPILED_READ;
const WRITES = new Set(['create-tree', 'create-commit', 'create-branch', 'create-draft-pr']);
const POST_ROUTES = Object.freeze({'create-tree':'git/trees','create-commit':'git/commits',
  'create-branch':'git/refs','create-draft-pr':'pulls'});
const WIRE_ROUTE = /^[A-Za-z0-9_/?=&:%.-]{1,512}$/;
const hash = value => createHash('sha256').update(value).digest('hex');
// A store.execute ledger object must never have two independent reservation queues.
const budgetInstances = new WeakSet();
const ENVELOPE_FIELDS = ['schema','repo','environment','target','action','envelopeDigest',
  'securityDigest','policyDigest','notBefore','expiresAt','paidApiUsd',
  'maxOperations','maxRequests','maxWrites'];
const EFFECT_FIELDS = ['effectId','taskId','taskSha','headSha','kind','method','route',
  'payloadSha256','requestSha256','envelopeDigest',
  'repo','environment','target','action'];
// Capture every checked field synchronously BEFORE enqueue/await. Reject accessors,
// inherited properties and non-plain objects rather than reading mutable input later.
function snapshot(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null))
    return null;
  const result = Object.create(null);
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value,key);
    if (!descriptor || !Object.hasOwn(descriptor,'value')) return null;
    result[key] = descriptor.value;
  }
  return Object.freeze(result);
}
const max = (x, limit) => Number.isSafeInteger(x) && x > 0 && x <= limit;
const h64 = x => typeof x === 'string' && HEX64.test(x);
const h40 = x => typeof x === 'string' && HEX40.test(x);
const ident = x => typeof x === 'string' && ID.test(x);
const deny = reason => Object.freeze({status:'DENIED', reason, reserved:false});
// The host passes the exact serialized transport identity. It must already have
// selected the trusted route and captured the outbound body before calling us.
// A write's wire fingerprint, unlike its envelope-specific effectId, survives
// issuer rotation, new envelope signatures and new caller-chosen effect IDs.
function validWire(e) {
  if (!h40(e.taskSha) || !h64(e.payloadSha256) || !h64(e.requestSha256) ||
      typeof e.route !== 'string' || !WIRE_ROUTE.test(e.route) ||
      e.route.includes('..') || e.route.startsWith('/')) return false;
  const graphqlRead = e.kind === COMPILED_READ;
  const read = isRead(e.kind);
  if (e.method !== (graphqlRead ? 'POST' : read ? 'GET' : 'POST')) return false;
  if (graphqlRead ? e.route !== 'graphql' :
      read ? e.payloadSha256 !== hash('') : POST_ROUTES[e.kind] !== e.route) return false;
  return e.requestSha256 === hash(JSON.stringify({
    method:e.method,route:e.route,payloadSha256:e.payloadSha256,
  }));
}

// A GraphQL POST is chargeable as a read ONLY when the exact descriptor
// originates from github-readonly's private compiled-query WeakSet. Caller
// flags, copied objects and arbitrary GraphQL POST bodies are not sufficient.
function genuineCompiledRead(descriptor, effect) {
  try {
    if (typeof githubReadonly.isCompiledGitHubRead !== 'function' ||
        !githubReadonly.isCompiledGitHubRead(descriptor) ||
        !Object.isFrozen(descriptor) ||
        ![Object.prototype,null].includes(Object.getPrototypeOf(descriptor))) return false;
    for (const key of ['method','route','payloadSha256','requestSha256']) {
      const own = Object.getOwnPropertyDescriptor(descriptor,key);
      if (!own || !Object.hasOwn(own,'value') || own.value !== effect[key]) return false;
    }
    const signal = Object.getOwnPropertyDescriptor(descriptor,'signal');
    return !!signal && Object.hasOwn(signal,'value') &&
      signal.value instanceof AbortSignal && !signal.value.aborted;
  } catch { return false; }
}

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
      !h40(effect.headSha) || !validWire(effect) ||
      typeof effect.kind !== 'string' || (!isRead(effect.kind) && !WRITES.has(effect.kind)) ||
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

function soundJournalEntry(entry, key) {
  const scope=entry?.scope;
  if (!h64(key) || !scope || scope.digest !== key ||
      validateEnvelope({schema:'asi.release-envelope.proposal.v1',
        ...scope,envelopeDigest:key,paidApiUsd:0},scope.notBefore) ||
      !same(scope,exactScope({envelopeDigest:key,...scope})) ||
      !Array.isArray(entry.claims) || entry.claims.length > MAX_CLAIMS ||
      !Number.isSafeInteger(entry.lastObservedAt) ||
      entry.lastObservedAt < scope.notBefore ||
      !Number.isSafeInteger(entry.requests) || entry.requests < 0 ||
      !Number.isSafeInteger(entry.writes) || entry.writes < 0 ||
      !Number.isSafeInteger(entry.operations) || entry.operations < 0 ||
      entry.requests > scope.maxRequests || entry.writes > scope.maxWrites ||
      entry.operations > scope.maxOperations ||
      !entry.claims.every(c=>c && ident(c.effectId) && ident(c.taskId) &&
        h40(c.headSha) && (isRead(c.kind) || WRITES.has(c.kind)) && validWire(c) &&
        Number.isSafeInteger(c.reservedAt) && c.reservedAt >= scope.notBefore &&
        c.reservedAt < scope.expiresAt && c.reservedAt <= entry.lastObservedAt &&
        c.phase === 'RESERVED' &&
        c.publicationJournal === `publication-${c.taskId}.json`) ||
      entry.requests !== entry.claims.length ||
      entry.writes !== entry.claims.filter(c=>!isRead(c.kind)).length ||
      entry.operations !== entry.claims.length ||
      new Set(entry.claims.map(c=>c.effectId)).size !== entry.claims.length ||
      new Set(entry.claims.filter(c=>!isRead(c.kind)).map(c=>c.requestSha256)).size !==
        entry.claims.filter(c=>!isRead(c.kind)).length) return false;
  return true;
}

/** One instance per existing store.execute transaction; no effects are run. */
export function createStandingPublisherBudget({store, ledger, clock=Date.now}={}) {
  must(typeof store?.file === 'function' && ledger && typeof ledger === 'object' &&
    !Array.isArray(ledger) && typeof clock === 'function', 'BUDGET_HOST_REQUIRED');
  must(!budgetInstances.has(ledger), 'BUDGET_DUPLICATE_TRANSACTION_INSTANCE');
  budgetInstances.add(ledger);
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
  return Object.freeze({reserve({envelope, effect, compiledReadDescriptor, afterDurableClaim}={}) {
    // A caller may reuse or mutate input objects, but no later mutation may
    // change the scope or effect of this particular reservation.
    let capturedEnvelope, capturedEffect;
    try {
      capturedEnvelope=snapshot(envelope,ENVELOPE_FIELDS);
      capturedEffect=snapshot(effect,EFFECT_FIELDS);
    } catch { capturedEnvelope=null; capturedEffect=null; }
    // Verify compiled provenance synchronously, before the queue/await. The
    // reader-owned frozen descriptor cannot be substituted later.
    let compiledReadProvenance=false, compiledSignal=null;
    if (capturedEffect?.kind === COMPILED_READ &&
        genuineCompiledRead(compiledReadDescriptor,capturedEffect)) {
      compiledReadProvenance=true;
      compiledSignal=Object.getOwnPropertyDescriptor(compiledReadDescriptor,'signal').value;
    }
    return enqueue(async () => {
      if (!capturedEnvelope || !capturedEffect) return deny('BUDGET_INPUT_INVALID');
      const envelope=capturedEnvelope, effect=capturedEffect;
      if (effect.kind === COMPILED_READ && !compiledReadProvenance)
        return deny('BUDGET_COMPILED_READ_PROVENANCE');
      if (compiledSignal?.aborted) return deny('BUDGET_COMPILED_READ_ABORTED');
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
      // A slow lock read must not authorize an already-expired envelope.
      const lockedAt=clock();
      if (!Number.isSafeInteger(lockedAt) || lockedAt < at) return deny('BUDGET_CLOCK_REGRESSION');
      if (validateEnvelope(envelope,lockedAt)) return deny('BUDGET_ENVELOPE_SCOPE');
      if (ledger.mode !== 'FAILED_LOCKED' || ledger.reason !== 'IN_FLIGHT_OR_CRASHED')
        return deny('BUDGET_NOT_IN_ACTIVE_TRANSACTION');
      must(ledger.schemaVersion === 'asi.execution-adapters.v1' && ledger.jobs &&
        typeof ledger.jobs === 'object' && !Array.isArray(ledger.jobs), 'BUDGET_LEDGER_INVALID');
      const root = ledger.standingDelegationBudget;
      if (root !== undefined) must(root && root.version === 1 && root.envelopes &&
        typeof root.envelopes === 'object' && !Array.isArray(root.envelopes) &&
        Object.keys(root.envelopes).length <= MAX_ENVELOPES, 'BUDGET_LEDGER_INVALID');
      const budget = root || {version:1,envelopes:{}};
      const current = budget.envelopes[envelope.envelopeDigest];
      const scope = exactScope(envelope);
      // Validate ALL existing claims and reject effect IDs used under another
      // envelope. A new signature never grants permission to replay an effect.
      // Audit historical claims across ALL signed envelopes before admitting
      // unrelated work. A forged duplicate in old history must not become
      // invisible merely because today's effect has a different identifier.
      const usedIds=new Set(),usedPosts=new Set();
      let latestObserved=0;
      for (const [key,entry] of Object.entries(budget.envelopes)) {
        must(soundJournalEntry(entry,key),'BUDGET_LEDGER_INVALID');
        latestObserved=Math.max(latestObserved,entry.lastObservedAt);
        for (const claim of entry.claims) {
          must(!usedIds.has(claim.effectId),'BUDGET_LEDGER_INVALID');
          usedIds.add(claim.effectId);
          if (!isRead(claim.kind)) {
            must(!usedPosts.has(claim.requestSha256),'BUDGET_LEDGER_INVALID');
            usedPosts.add(claim.requestSha256);
          }
        }
      }
      // The signed-envelope boundary must not reset the durable clock floor.
      if (lockedAt < latestObserved) return deny('BUDGET_CLOCK_REGRESSION');
      if (usedIds.has(effect.effectId) ||
          (!isRead(effect.kind) && usedPosts.has(effect.requestSha256)))
        return deny('BUDGET_REPLAY_OR_UNKNOWN');
      if (current) {
        must(same(current.scope,scope),'BUDGET_LEDGER_INVALID');
        if (lockedAt < current.lastObservedAt) return deny('BUDGET_CLOCK_REGRESSION');
      }
      if (!current && Object.keys(budget.envelopes).length >= MAX_ENVELOPES)
        return deny('BUDGET_HISTORY_FULL');
      const before = current || {scope, lastObservedAt:lockedAt, operations:0, requests:0, writes:0, claims:[]};
      const write = isRead(effect.kind) ? 0 : 1;
      if (before.operations + 1 > scope.maxOperations ||
          before.requests + 1 > scope.maxRequests || before.writes + write > scope.maxWrites ||
          before.claims.length >= MAX_CLAIMS) return deny('BUDGET_EXHAUSTED');
      // A reservation is irreversible, even when the API call fails or times out.
      // Existing publication-${taskId}.json INTENT and state.execute FAILED_LOCKED
      // provide remote-result evidence and the crash brake; neither is reset here.
      const claim = {effectId:effect.effectId,taskId:effect.taskId,taskSha:effect.taskSha,
        headSha:effect.headSha,kind:effect.kind,method:effect.method,route:effect.route,
        payloadSha256:effect.payloadSha256,requestSha256:effect.requestSha256,
        reservedAt:lockedAt, phase:'RESERVED',
        publicationJournal:`publication-${effect.taskId}.json`};
      const updated = {...before,lastObservedAt:lockedAt,operations:before.operations + 1,
        requests:before.requests + 1,writes:before.writes + write,
        claims:[...before.claims,claim]};
      const next = {version:1,envelopes:{...budget.envelopes,[scope.digest]:updated}};
      // Exactly one durable commit using the existing atomic file writer.
      // Do not mutate the shared in-memory ledger before fsync success.
      await atomicJson(store.file('autopilot-ledger.json'),{...ledger,standingDelegationBudget:next});
      ledger.standingDelegationBudget = next;
      // The genuine transaction's post-fsync check runs INSIDE the already
      // existing reservation queue, before another queued claim may be spent.
      // No second queue/lock/ledger is introduced. A terminal uncertainty
      // poisons this queue without refunding the durable claim.
      if (afterDurableClaim !== undefined) {
        let lateReason;
        try { lateReason = typeof afterDurableClaim === 'function'
          ? afterDurableClaim() : 'BUDGET_POST_COMMIT_CHECK_INVALID'; }
        catch { lateReason = 'BUDGET_POST_COMMIT_CHECK_FAILED'; }
        if (lateReason !== null) {
          poisoned = true;
          return deny(typeof lateReason === 'string' &&
            /^BUDGET_[A-Z_]+$/.test(lateReason)
            ? lateReason : 'BUDGET_POST_COMMIT_CHECK_INVALID');
        }
      }
      // Compiled-read cancellation after fsync is irreversible uncertainty.
      if (compiledSignal?.aborted) {
        poisoned = true;
        return deny('BUDGET_COMPILED_READ_ABORTED_AFTER_RESERVATION');
      }
      return Object.freeze({status:'RESERVED',reserved:true,envelopeDigest:scope.digest,
        effectId:claim.effectId,taskId:claim.taskId,taskSha:claim.taskSha,
        requestSha256:claim.requestSha256,headSha:claim.headSha,
        kind:claim.kind,operations:updated.operations,requests:updated.requests,
        writes:updated.writes});
    });
  }});
}
