/**
 * Source-only 365-day parent/short-child cumulative budget contract for #551.
 * NO permission, receipt, fsync, signature verification, journal write or dispatch.
 *
 * Integration prerequisite: independently authenticate the parent and *each*
 * child-to-parent link (issuer, scope and validity) from protected Git/keys.
 * The host must invoke this within the EXISTING state.execute / budget queue
 * and fsync the spent claim into EXISTING autopilot-ledger.json before effect.
 * An unsigned caller-supplied link can NEVER establish authority. Output is
 * deliberately `authorized:false` even when source invariants are satisfied.
 * Do not use as a replacement for standing-budget.mjs's wire/claim validation.
 */
import {createHash} from 'node:crypto';

const hex64 = s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const hex40 = s => typeof s === 'string' && /^[a-f0-9]{40}$/.test(s);
const ident = s => typeof s === 'string' && /^[a-z0-9][a-z0-9-]{0,95}$/.test(s);
const validCount = (x, max) => Number.isSafeInteger(x) && x > 0 && x <= max;
const YEAR_MS = 365 * 86400000;
const CHILD_MS = 14 * 86400000;
// Explicitly allow >27 child renewals while retaining ALL historical claims.
// Larger retention requires a separate review of the existing 4MB state bound.
const MAX_CHILDREN = 64;
const MAX_CLAIMS = 256; // Existing bounded Publisher request history.
const WRITES = new Set(['create-tree','create-commit','create-branch','create-draft-pr']);
const SHA = v => createHash('sha256').update(v).digest('hex');
const deny = reason => Object.freeze({status:'PARENT_BUDGET_DENIED', reason, authorized:false});
const plain = x => x && typeof x === 'object' && !Array.isArray(x) &&
  [Object.prototype,null].includes(Object.getPrototypeOf(x)) &&
  Reflect.ownKeys(x).every(k => typeof k === 'string' &&
    Object.hasOwn(Object.getOwnPropertyDescriptor(x,k),'value'));
const validTime = t => Number.isSafeInteger(t) && t >= 0;
const same = (a,b) => a === b;
const isWrite = k => WRITES.has(k);
const isRead = k => k === 'github-read' || k === 'github-compiled-read';

function parentScope(p, now) {
  return plain(p) && p.schema === 'asi.standing-parent.proposal.v1' &&
    hex64(p.digest) && hex64(p.securityDigest) && hex64(p.policyDigest) &&
    p.repo === 'ASI-integration/asi-landing' &&
    p.environment === 'beget-staging' && p.target === 'pqukibofpo' &&
    p.action === 'source' && p.paidApiUsd === 0 &&
    validTime(p.notBefore) && validTime(p.expiresAt) &&
    p.notBefore <= now && now < p.expiresAt &&
    p.expiresAt > p.notBefore && p.expiresAt - p.notBefore <= YEAR_MS &&
    validCount(p.maxOperations,MAX_CLAIMS) &&
    validCount(p.maxRequests,MAX_CLAIMS) && validCount(p.maxWrites,64) &&
    p.maxWrites <= p.maxOperations && p.maxWrites <= p.maxRequests;
}
function childScope(c, p) {
  return plain(c) && hex64(c.digest) && hex64(c.securityDigest) &&
    hex64(c.policyDigest) && validTime(c.notBefore) && validTime(c.expiresAt) &&
    c.notBefore >= p.notBefore && c.expiresAt <= p.expiresAt &&
    c.expiresAt > c.notBefore && c.expiresAt-c.notBefore <= CHILD_MS &&
    ['repo','environment','target','action','securityDigest','policyDigest'].every(k=>same(c[k],p[k])) &&
    validCount(c.maxOperations,MAX_CLAIMS) && validCount(c.maxRequests,MAX_CLAIMS) &&
    validCount(c.maxWrites,64) && c.maxWrites <= c.maxOperations &&
    c.maxWrites <= c.maxRequests;
}
function checkClaim(c, s) {
  if (!plain(c) || !ident(c.effectId) || !ident(c.taskId) || !hex40(c.taskSha) ||
      !hex40(c.headSha) || !hex64(c.requestSha256) || !hex64(c.payloadSha256) ||
      !validTime(c.reservedAt) || c.reservedAt < s.notBefore ||
      c.reservedAt >= s.expiresAt || c.phase !== 'RESERVED' ||
      c.publicationJournal !== `publication-${c.taskId}.json` ||
      (!isRead(c.kind) && !isWrite(c.kind)) ||
      !['GET','POST'].includes(c.method) || typeof c.route !== 'string' ||
      c.requestSha256 !== SHA(JSON.stringify({method:c.method,route:c.route,
        payloadSha256:c.payloadSha256}))) return false;
  return true;
}
function boundLink(link, scope, p) {
  return plain(link) && link.childDigest === scope.digest &&
    link.parentDigest === p.digest && hex64(link.issuerKeyDigest) &&
    link.notBefore === scope.notBefore && link.expiresAt === scope.expiresAt &&
    link.repo === scope.repo && link.environment === scope.environment &&
    link.target === scope.target && link.action === scope.action &&
    link.securityDigest === scope.securityDigest && link.policyDigest === scope.policyDigest;
}
/** Pure contract check only; never implies a verified signer or atomic claim. */
export function assessParentBudgetProposal({parent, child, childLinks, ledger, effect, now,
  revokedParentDigests=[]}={}) {
  if (!validTime(now) || !parentScope(parent,now)) return deny('PARENT_INVALID_OR_EXPIRED');
  if (!Array.isArray(revokedParentDigests) || !revokedParentDigests.every(hex64) ||
      revokedParentDigests.includes(parent.digest)) return deny('PARENT_REVOKED_OR_UNVERIFIED_REVOCATION');
  if (!plain(ledger) || ledger.schemaVersion !== 'asi.execution-adapters.v1' ||
      !plain(ledger.standingDelegationBudget) ||
      ledger.standingDelegationBudget.version !== 1 ||
      !plain(ledger.standingDelegationBudget.envelopes) || !plain(childLinks) ||
      !childScope(child,parent) || !boundLink(childLinks[child.digest],child,parent))
    return deny('PARENT_HISTORY_OR_LINK_INVALID');
  if (!plain(effect) || !ident(effect.effectId) || !hex64(effect.requestSha256) ||
      (!isRead(effect.kind) && !isWrite(effect.kind))) return deny('PARENT_EFFECT_INVALID');
  const entries=Object.entries(ledger.standingDelegationBudget.envelopes);
  if (entries.length > MAX_CHILDREN) return deny('PARENT_HISTORY_FULL');
  let operations=0, requests=0, writes=0, newest=0;
  const effectIds=new Set(), postWires=new Set();
  for (const [digest,entry] of entries) {
    if (!hex64(digest) || !plain(entry) || !plain(entry.scope) ||
        entry.scope.digest !== digest || !Array.isArray(entry.claims) ||
        entry.claims.length > MAX_CLAIMS || !validTime(entry.lastObservedAt) ||
        !Number.isSafeInteger(entry.operations) || !Number.isSafeInteger(entry.requests) ||
        !Number.isSafeInteger(entry.writes) || !childScope(entry.scope,parent) ||
        !boundLink(childLinks[digest],entry.scope,parent))
      return deny('PARENT_HISTORY_OR_LINK_INVALID');
    // All claims must remain present: no compaction or historical reset.
    const claimedWrites=entry.claims.filter(c=>plain(c) && isWrite(c.kind)).length;
    if (entry.requests !== entry.claims.length || entry.operations !== entry.claims.length ||
        entry.writes !== claimedWrites || entry.requests > entry.scope.maxRequests ||
        entry.operations > entry.scope.maxOperations || entry.writes > entry.scope.maxWrites)
      return deny('PARENT_HISTORY_COUNTER_MISMATCH');
    newest=Math.max(newest,entry.lastObservedAt);
    for (const claim of entry.claims) {
      if (!checkClaim(claim,entry.scope) || claim.reservedAt > entry.lastObservedAt ||
          effectIds.has(claim.effectId) || (isWrite(claim.kind) && postWires.has(claim.requestSha256)))
        return deny('PARENT_HISTORY_REPLAY_OR_CORRUPTION');
      effectIds.add(claim.effectId);
      if (isWrite(claim.kind))postWires.add(claim.requestSha256);
    }
    operations += entry.operations; requests += entry.requests; writes += entry.writes;
  }
  if (now < newest) return deny('PARENT_CLOCK_REGRESSION');
  if (!entries.some(([digest])=>digest===child.digest) && entries.length>=MAX_CHILDREN)
    return deny('PARENT_HISTORY_FULL');
  if (now < child.notBefore || now >= child.expiresAt) return deny('PARENT_CHILD_EXPIRED');
  if (effectIds.has(effect.effectId) || (isWrite(effect.kind) && postWires.has(effect.requestSha256)))
    return deny('PARENT_REPLAY');
  const childEntry=ledger.standingDelegationBudget.envelopes[child.digest];
  const childCount=childEntry?.claims.length ?? 0;
  const childWrites=childEntry?.writes ?? 0;
  const plusWrite=Number(isWrite(effect.kind));
  if (childCount+1 > child.maxOperations || childCount+1 > child.maxRequests ||
      childWrites+plusWrite > child.maxWrites)
    return deny('CHILD_BUDGET_EXHAUSTED');
  if (operations+1 > parent.maxOperations || requests+1 > parent.maxRequests ||
      writes+plusWrite > parent.maxWrites)
    return deny('PARENT_CUMULATIVE_BUDGET_EXHAUSTED');
  // CRITICAL: This is only input for a future in-lock integrated decision.
  // No signed proof, fsync, network effect, or authorization is provided.
  return Object.freeze({status:'PARENT_BUDGET_SOURCE_ELIGIBLE',authorized:false,
    parentDigest:parent.digest,childDigest:child.digest,
    operations:operations+1,requests:requests+1,writes:writes+plusWrite,
    retainedChildren:entries.length+Number(!childEntry)});
}
