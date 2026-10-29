/**
 * Non-authorizing bridge: reserve only within a genuine, live Publisher
 * state.execute transaction. No alternate lock/ledger or remote capability.
 * The signed owner-pinned base SHA must be supplied by the protected host.
 * Every caller must separately verify authority/revocation/CI/review and must
 * never interpret RESERVED as permission to dispatch.
 */
import path from 'node:path';
import * as state from './state.mjs';
const {inspectStandingTransaction, must} = state;
import {createStandingPublisherBudget} from './standing-budget.mjs';

const SHA40 = /^[0-9a-f]{40}$/;
const EFFECT_KEYS = ['effectId','taskId','taskSha','headSha','kind','method','route',
  'payloadSha256','requestSha256','envelopeDigest','repo','environment','target','action'];
const ENVELOPE_KEYS = ['schema','repo','environment','target','action','envelopeDigest',
  'securityDigest','policyDigest','notBefore','expiresAt','paidApiUsd',
  'maxOperations','maxRequests','maxWrites'];
const deny = reason => Object.freeze({status:'DENIED',reason,reserved:false,authorized:false});
function capture(value, keys=EFFECT_KEYS) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![null,Object.prototype].includes(Object.getPrototypeOf(value))) return null;
  const out = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value,key);
    if (!d || !Object.hasOwn(d,'value')) return null;
    out[key] = d.value;
  }
  return Object.freeze(out);
}
function sameLease(a,b) {
  return a.transactionId === b.transactionId && a.root === b.root &&
    a.ledger === b.ledger && a.kind === b.kind &&
    a.phase === b.phase && a.taskId === b.taskId && a.taskSha === b.taskSha;
}

/** Host-derived transaction token only; never accept a caller-chosen store/path. */
export function createLeaseBoundStandingBudget({transaction,pinnedBaseSha,clock=Date.now}={}) {
  must(typeof inspectStandingTransaction === 'function',
    'BUDGET_LEASE_RUNTIME_NOT_IN_BASE');
  must(typeof pinnedBaseSha === 'string' && SHA40.test(pinnedBaseSha),
    'BUDGET_PROTECTED_BASE_REQUIRED');
  const initial = inspectStandingTransaction(transaction);
  must(initial.kind === 'github-publisher' && path.isAbsolute(initial.root) &&
    initial.ledger && typeof initial.transactionId === 'string',
  'BUDGET_PUBLISHER_LEASE_REQUIRED');
  const boundStore = Object.freeze({root:initial.root,file(name) {
    must(name === 'execution.lock' || name === 'autopilot-ledger.json',
      'BUDGET_STATE_PATH_DENIED');
    return path.join(initial.root,'state',name);
  }});
  // The signed cap must not be revived by a backwards wall-clock jump
  // between the durable fsync and the final transaction-lease check.
  let clockHighWater = -1, poisoned = false;
  // Once an irreversible claim has been spent but its lease/clock cannot
  // be trusted, this adapter must not issue another claim in this execute.
  const poison = reason => {poisoned = true; return deny(reason);};
  const observedClock = () => {
    const now = clock();
    if (Number.isSafeInteger(now) && now >= 0)
      clockHighWater = Math.max(clockHighWater, now);
    return now;
  };
  const budget = createStandingPublisherBudget({store:boundStore,
    ledger:initial.ledger,clock:observedClock});
  return Object.freeze({reserve({envelope,effect,compiledReadDescriptor}={}) {
    if (poisoned) return Promise.resolve(deny('BUDGET_UNCERTAIN_TRANSACTION'));
    // Snapshot the full signed scope and outbound effect before any await.
    let captured, signedScope;
    try {captured=capture(effect);signedScope=capture(envelope,ENVELOPE_KEYS);}
    catch {captured=null;signedScope=null;}
    if (!captured || !signedScope)return Promise.resolve(deny('BUDGET_INPUT_INVALID'));
    // Private compiled GraphQL POST reads must consume API quota, not write quota.
    // Low-level budget independently verifies the genuine frozen descriptor.
    const write=captured.kind !== 'github-read' && captured.kind !== 'github-compiled-read';
    let before;
    try {before=inspectStandingTransaction(transaction,{write});}
    catch {return Promise.resolve(deny('BUDGET_LEASE_INACTIVE'));}
    if (before.transactionId !== initial.transactionId || before.root !== initial.root ||
        before.ledger !== initial.ledger || before.kind !== initial.kind ||
        !['admission','preflight','started','postflight'].includes(before.phase))
      return Promise.resolve(deny('BUDGET_LEASE_CHANGED'));
    if (before.taskId === null) {
      if (before.phase !== 'admission' ||
          captured.taskId !== `admission-${before.transactionId}` ||
          captured.taskSha !== pinnedBaseSha)
        return Promise.resolve(deny('BUDGET_ADMISSION_TASK_MISMATCH'));
    } else if (before.taskSha !== pinnedBaseSha ||
               captured.taskId !== before.taskId ||
               captured.taskSha !== before.taskSha)
      return Promise.resolve(deny('BUDGET_SELECTED_TASK_MISMATCH'));
    // These phase and identity checks are independent of the lock-directory
    // lstat used by the low-level journal adapter.
    return (async () => {
      let current;
      try {current=inspectStandingTransaction(transaction,{write});}
      catch {return deny('BUDGET_LEASE_INACTIVE');}
      if (!sameLease(current,before))return deny('BUDGET_LEASE_CHANGED');
      // Complete the real lease/clock check before the existing fsync queue
      // advances to a second concurrent reservation. Previously two callers
      // could both enqueue before the first post-fsync expiry poisoned the lease.
      const afterDurableClaim = () => {
        let live;
        try {live=inspectStandingTransaction(transaction,{write});}
        catch {poisoned=true;return 'BUDGET_LEASE_EXPIRED_AFTER_RESERVATION';}
        if (!sameLease(live,before)) {
          poisoned=true;return 'BUDGET_LEASE_CHANGED_AFTER_RESERVATION';
        }
        let finishedAt;
        try {finishedAt=observedClock();}
        catch {poisoned=true;return 'BUDGET_CLOCK_AFTER_RESERVATION';}
        if (!Number.isSafeInteger(finishedAt) || finishedAt < signedScope.notBefore ||
            finishedAt < clockHighWater) {
          poisoned=true;return 'BUDGET_CLOCK_AFTER_RESERVATION';
        }
        if (finishedAt >= signedScope.expiresAt) {
          poisoned=true;return 'BUDGET_ENVELOPE_EXPIRED_AFTER_RESERVATION';
        }
        return null;
      };
      let result;
      try {
        result=await budget.reserve({envelope:signedScope,effect:captured,
          compiledReadDescriptor,afterDurableClaim});
      } catch (error) {poisoned=true;throw error;}
      if (result.status !== 'RESERVED') {
        if (result.reason === 'BUDGET_COMPILED_READ_ABORTED_AFTER_RESERVATION')
          poisoned=true;
        if (poisoned && result.reason === 'BUDGET_UNCERTAIN_STORAGE')
          return deny('BUDGET_UNCERTAIN_TRANSACTION');
        return Object.freeze({...result,authorized:false});
      }
      // The transaction can close or its selected task can change between
      // the inner post-fsync check and resumption of this awaiting caller.
      // Recheck the time first (host clocks may have side effects in tests),
      // then inspect the genuine lease without another await. Once spent,
      // a late mismatch is irreversibly uncertain, never a fresh permit.
      let returnedAt;
      try {returnedAt=observedClock();}
      catch {return poison('BUDGET_CLOCK_AFTER_RESERVATION');}
      if(!Number.isSafeInteger(returnedAt) || returnedAt < signedScope.notBefore ||
          returnedAt < clockHighWater)
        return poison('BUDGET_CLOCK_AFTER_RESERVATION');
      if(returnedAt >= signedScope.expiresAt)
        return poison('BUDGET_ENVELOPE_EXPIRED_AFTER_RESERVATION');
      let returnedLease;
      try {returnedLease=inspectStandingTransaction(transaction,{write});}
      catch {return poison('BUDGET_LEASE_EXPIRED_AFTER_RESERVATION');}
      if(!sameLease(returnedLease,before))
        return poison('BUDGET_LEASE_CHANGED_AFTER_RESERVATION');
      // RESERVED still grants NO authority to dispatch or change governance.
      return Object.freeze({...result,authorized:false});
    })();
  }});
}
