/**
 * Source-only, non-authorizing task/claim binding for the existing Publisher.
 *
 * The trusted host must supply `task` from its approved catalog and call this
 * immediately before EVERY post-STARTED reservation while holding the genuine
 * store.execute lock. This pure check neither owns that lock nor verifies signed
 * authority, revocation, CI/review, admission-phase reads or transport identity.
 * An early admission/read phase MUST be separately bound by the protected host;
 * do not pass a fabricated STARTED job or treat this check as effect permission.
 */
const SHA = /^[a-f0-9]{40}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/;
const REPO = 'ASI-integration/asi-landing';
const READ = 'github-read';
const WRITE = new Set(['create-tree','create-commit','create-branch','create-draft-pr']);
const deny = reason => Object.freeze({status:'DENIED', reason, authorized:false});
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x) &&
  (Object.getPrototypeOf(x) === Object.prototype || Object.getPrototypeOf(x) === null);
const own = (o,k) => {
  const d=Object.getOwnPropertyDescriptor(o,k);
  return d && Object.hasOwn(d,'value') ? d.value : undefined;
};
const sha = x => typeof x === 'string' && SHA.test(x);
const id = x => typeof x === 'string' && ID.test(x);

/** A predicate, NEVER an authorization or a remote effect capability. */
export function assessStartedPublisherBudgetTask({ledger,task,effect}={}) {
  try {
    if (!plain(ledger) || !plain(task) || !plain(effect) || !plain(own(ledger,'jobs')))
      return deny('BUDGET_TASK_CONTEXT_INVALID');
    if (own(ledger,'schemaVersion') !== 'asi.execution-adapters.v1' ||
        own(ledger,'mode') !== 'FAILED_LOCKED' ||
        own(ledger,'reason') !== 'IN_FLIGHT_OR_CRASHED')
      return deny('BUDGET_LEDGER_NOT_ARMED');
    const taskId=own(task,'id'), taskSha=own(task,'sha');
    if (!id(taskId) || !sha(taskSha) || own(task,'kind') !== 'github-publisher' ||
        own(task,'stage') !== 'S4-G1' || own(task,'repo') !== REPO || own(task,'pr') !== null)
      return deny('BUDGET_TASK_CONTEXT_INVALID');
    const effectId=own(effect,'taskId'), effectSha=own(effect,'taskSha');
    const headSha=own(effect,'headSha'), kind=own(effect,'kind');
    if (!id(effectId) || !sha(effectSha) || !sha(headSha) ||
        (kind !== READ && !WRITE.has(kind)))
      return deny('BUDGET_EFFECT_UNSUPPORTED');
    if (effectId !== taskId || effectSha !== taskSha)
      return deny('BUDGET_TASK_BINDING_CHANGED');
    const jobs=own(ledger,'jobs');
    const jobIds=Object.keys(jobs);
    if (jobIds.length>10000) return deny('BUDGET_TASK_CONTEXT_INVALID');
    let started=0, matched=false;
    for(const key of jobIds) {
      if (!id(key)) return deny('BUDGET_TASK_CONTEXT_INVALID');
      const job=own(jobs,key);
      if (!plain(job) || typeof own(job,'mode') !== 'string')
        return deny('BUDGET_TASK_CONTEXT_INVALID');
      if (own(job,'mode') !== 'STARTED') continue;
      started++;
      if (key===taskId && own(job,'kind') === 'github-publisher' &&
          own(job,'sha') === taskSha && own(job,'pr') === null)
        matched=true;
    }
    if (started!==1) return deny('BUDGET_ACTIVE_JOB_NOT_UNIQUE');
    if (!matched) return deny('BUDGET_TASK_BINDING_CHANGED');
    return Object.freeze({status:'TASK_BOUND',authorized:false,taskId,taskSha});
  } catch { // Proxies and host object traps cannot turn a malformed input into admission.
    return deny('BUDGET_TASK_CONTEXT_INVALID');
  }
}
