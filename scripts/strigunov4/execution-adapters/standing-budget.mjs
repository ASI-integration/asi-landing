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
import {isCompiledGitHubRead} from './github-readonly.mjs';

const HEX64 = /^[0-9a-f]{64}$/;
const HEX40 = /^[0-9a-f]{40}$/;
const ID = /^[a-z0-9][a-z0-9-]{0,95}$/;
const REPO = 'ASI-integration/asi-landing';
const TIME_LIMIT = 14 * 86400000;
const MAX_ENVELOPES = 16;
const MAX_CLAIMS = 256;
const READ = 'github-read';
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
  const read = e.kind === READ;
  const query=read&&e.readProtocol==='compiled-threads';
  if(query){if(e.method!=='POST'||e.route!=='graphql')return false;}
  else {
    if(e.readProtocol!==undefined||e.method!==(read?'GET':'POST'))return false;
    if(read?e.payloadSha256!==hash(''):POST_ROUTES[e.kind]!==e.route)return false;
  }
  return e.requestSha256 === hash(JSON.stringify({
    method:e.method,route:e.route,payloadSha256:e.payloadSha256,
  }));
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
        h40(c.headSha) && (c.kind === READ || WRITES.has(c.kind)) && validWire(c) &&
        Number.isSafeInteger(c.reservedAt) && c.reservedAt >= scope.notBefore &&
        c.reservedAt < scope.expiresAt && c.reservedAt <= entry.lastObservedAt &&
        c.phase === 'RESERVED' &&
        c.publicationJournal === `publication-${c.taskId}.json`) ||
      entry.requests !== entry.claims.length ||
      entry.writes !== entry.claims.filter(c=>c.kind !== READ).length ||
      entry.operations !== entry.claims.length ||
      new Set(entry.claims.map(c=>c.effectId)).size !== entry.claims.length ||
      new Set(entry.claims.filter(c=>c.kind!==READ).map(c=>c.requestSha256)).size !==
        entry.claims.filter(c=>c.kind!==READ).length) return false;
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
  return Object.freeze({reserve({envelope, effect, readDescriptor}={}) {
    // A caller may reuse or mutate input objects, but no later mutation may
    // change the scope or effect of this particular reservation.
    let capturedEnvelope, capturedEffect;
    try {
      capturedEnvelope=snapshot(envelope,ENVELOPE_FIELDS);
      capturedEffect=snapshot(effect,EFFECT_FIELDS);
      if(capturedEffect?.kind===READ&&capturedEffect.method==='POST'){
        if(!isCompiledGitHubRead(readDescriptor)||!['method','route','payloadSha256','requestSha256'].every(k=>readDescriptor[k]===capturedEffect[k]))capturedEffect=null;
        else capturedEffect=Object.freeze({...capturedEffect,readProtocol:'compiled-threads'});
      }
    } catch { capturedEnvelope=null; capturedEffect=null; }
    return enqueue(async () => {
      if (!capturedEnvelope || !capturedEffect) return deny('BUDGET_INPUT_INVALID');
      const envelope=capturedEnvelope, effect=capturedEffect;
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
      // Historical duplicates must also block unrelated new work: checking only
      // today's effect would silently accept an already-corrupt cross-envelope journal.
      const usedIds=new Set(),usedPosts=new Set();
      let latestObserved=0;
      for (const [key,entry] of Object.entries(budget.envelopes)) {
        must(soundJournalEntry(entry,key),'BUDGET_LEDGER_INVALID');
        latestObserved=Math.max(latestObserved,entry.lastObservedAt);
        for(const claim of entry.claims){
          must(!usedIds.has(claim.effectId),'BUDGET_LEDGER_INVALID');
          usedIds.add(claim.effectId);
          if(claim.kind!==READ){
            must(!usedPosts.has(claim.requestSha256),'BUDGET_LEDGER_INVALID');
            usedPosts.add(claim.requestSha256);
          }
        }
      }
      if(lockedAt<latestObserved)return deny('BUDGET_CLOCK_REGRESSION');
      if(usedIds.has(effect.effectId)||(effect.kind!==READ&&usedPosts.has(effect.requestSha256)))
        return deny('BUDGET_REPLAY_OR_UNKNOWN');
      if (current) {
        must(same(current.scope,scope),'BUDGET_LEDGER_INVALID');
        if (lockedAt < current.lastObservedAt) return deny('BUDGET_CLOCK_REGRESSION');
      }
      if (!current && Object.keys(budget.envelopes).length >= MAX_ENVELOPES)
        return deny('BUDGET_HISTORY_FULL');
      const before = current || {scope, lastObservedAt:lockedAt, operations:0, requests:0, writes:0, claims:[]};
      const write = effect.kind === READ ? 0 : 1;
      if (before.operations + 1 > scope.maxOperations ||
          before.requests + 1 > scope.maxRequests || before.writes + write > scope.maxWrites ||
          before.claims.length >= MAX_CLAIMS) return deny('BUDGET_EXHAUSTED');
      // A reservation is irreversible, even when the API call fails or times out.
      // Existing publication-${taskId}.json INTENT and state.execute FAILED_LOCKED
      // provide remote-result evidence and the crash brake; neither is reset here.
      const claim = {effectId:effect.effectId,taskId:effect.taskId,taskSha:effect.taskSha,
        headSha:effect.headSha,kind:effect.kind,method:effect.method,route:effect.route,
        payloadSha256:effect.payloadSha256,requestSha256:effect.requestSha256,
        ...(effect.readProtocol?{readProtocol:effect.readProtocol}:{}),
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
      return Object.freeze({status:'RESERVED',reserved:true,envelopeDigest:scope.digest,
        effectId:claim.effectId,taskId:claim.taskId,taskSha:claim.taskSha,
        requestSha256:claim.requestSha256,headSha:claim.headSha,
        kind:claim.kind,operations:updated.operations,requests:updated.requests,
        writes:updated.writes});
    });
  }});
}
