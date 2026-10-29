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
const deny = reason => Object.freeze({status:'DENIED',reason,reserved:false,authorized:false});
function capture(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![null,Object.prototype].includes(Object.getPrototypeOf(value))) return null;
  const out = {};
  for (const key of EFFECT_KEYS) {
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
  const budget = createStandingPublisherBudget({store:boundStore,
    ledger:initial.ledger,clock});
  return Object.freeze({reserve({envelope,effect}={}) {
    // Snapshot before the first await, without executing accessors.
    let captured;
    try {captured=capture(effect);} catch {captured=null;}
    if (!captured)return Promise.resolve(deny('BUDGET_INPUT_INVALID'));
    const write=captured.kind !== 'github-read';
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
      const result=await budget.reserve({envelope,effect:captured});
      if (result.status !== 'RESERVED')return Object.freeze({...result,authorized:false});
      // If execute closed or advanced phase while awaiting fsync, the spent
      // claim remains irreversible, but no remote effect may follow.
      try {current=inspectStandingTransaction(transaction,{write});}
      catch {return deny('BUDGET_LEASE_EXPIRED_AFTER_RESERVATION');}
      if (!sameLease(current,before))
        return deny('BUDGET_LEASE_CHANGED_AFTER_RESERVATION');
      return Object.freeze({...result,authorized:false});
    })();
  }});
}
