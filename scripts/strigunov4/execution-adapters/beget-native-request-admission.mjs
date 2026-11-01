/**
 * Exact-wire admission for the ORIGINAL Publisher transport and ledger.
 * No network, new queue, daemon or separate durable budget. The root-signed
 * parent/child are rechecked before each irreversible reservation.
 */
import {randomUUID} from 'node:crypto';
import {createStandingPublisherBudget} from './standing-budget.mjs';
import {inspectStandingTransaction,must,digest} from './state.mjs';

const POST=Object.freeze({
  'git/trees':'create-tree','git/commits':'create-commit',
  'git/refs':'create-branch','pulls':'create-draft-pr'
});
export function createBegetNativeRequestAdmission({
  store,ledger,transaction,authority,clock=Date.now
}={}){
  must(authority?.payload?.schema==='asi.engine-beget-five-lane-activation.v1'&&
    typeof authority.signedDelegation==='function'&&
    typeof authority.revalidate==='function',
    'NATIVE_GITHUB_SIGNED_HOST_REQUIRED');
  const pinned=inspectStandingTransaction(transaction);
  must(pinned.root===store.root&&pinned.ledger===ledger&&
    pinned.kind==='github-publisher','NATIVE_GITHUB_TRANSACTION_REQUIRED');
  // The V2 authority authenticates owner parent, signed child, revocations and
  // exact protected main BEFORE every reservation. Ordinary stage grants
  // still use the budget's unmodified 14-day default.
  const budget=createStandingPublisherBudget({store,ledger,transaction,
    admissionBaseSha:authority.payload.baseSha,nativeV2YearLease:true,clock});
  let pending=Promise.resolve();
  return function requestAdmission(descriptor){
    const run=async()=>{
      must(descriptor&&typeof descriptor.method==='string'&&
        typeof descriptor.route==='string'&&
        /^[a-f0-9]{64}$/.test(descriptor.payloadSha256)&&
        /^[a-f0-9]{64}$/.test(descriptor.requestSha256)&&
        descriptor.signal?.aborted!==true,'NATIVE_GITHUB_WIRE_INVALID');
      must(await authority.revalidate()===true,'NATIVE_GITHUB_AUTHORITY_CHANGED');
      must(await authority.checkRevocationCheckpoint({
        store,ledger,transaction})===true,'NATIVE_GITHUB_REVOCATION_CHECKPOINT');
      const signed=await authority.signedDelegation();
      const p=signed.parent,c=signed.child,lease=inspectStandingTransaction(transaction);
      must(lease.transactionId===pinned.transactionId&&
        lease.kind==='github-publisher'&&lease.ledger===ledger&&
        c.repo===authority.payload.repo&&
        c.baseSha===authority.payload.baseSha&&
        c.digest===signed.child.digest&&
        c.parentDigest===p.digest,'NATIVE_GITHUB_SIGNED_CHILD_CHANGED');
      const kind=descriptor.method==='GET'||descriptor.route==='graphql'?
        'github-read':POST[descriptor.route];
      must(kind&&
        (kind==='github-read'||lease.phase==='started')&&
        (kind!=='github-read'||descriptor.method==='GET'||
          descriptor.method==='POST'&&descriptor.route==='graphql'),
        'NATIVE_GITHUB_ACTION_NOT_ADMITTED');
      // One serialized native lock also enforces the entire 365-day parent
      // aggregate across previous retained children, without reset on renewal.
      const old=ledger.standingDelegationBudget;
      must(old===undefined||old?.version===1&&old.envelopes&&
        typeof old.envelopes==='object',
        'NATIVE_GITHUB_PARENT_HISTORY_INVALID');
      const entries=Object.values(old?.envelopes??{});
      const spent=entries.reduce((n,e)=>({
        operations:n.operations+e.operations,requests:n.requests+e.requests,
        writes:n.writes+e.writes
      }),{operations:0,requests:0,writes:0});
      must(spent.operations+1<=p.maxOperations&&
        spent.requests+1<=p.maxRequests&&
        spent.writes+Number(kind!=='github-read')<=p.maxWrites,
        'NATIVE_GITHUB_PARENT_BUDGET_EXHAUSTED');
      // Every previous signed child must be verified from its original signer
      // and historical first-claim time before renewal can spend more budget.
      must(await authority.verifyChildHistory(ledger)===true,
        'NATIVE_GITHUB_OLDER_CHILD_NEEDS_SIGNED_HISTORY');
      const taskId=lease.phase==='admission'?
        'admission-'+lease.transactionId:lease.taskId;
      const taskSha=lease.phase==='admission'?
        authority.payload.baseSha:lease.taskSha;
      const envelope={schema:'asi.release-envelope.proposal.v1',
        repo:c.repo,environment:c.environment,target:c.target,action:c.action,
        envelopeDigest:c.digest,securityDigest:c.securityDigest,
        policyDigest:c.policyDigest,notBefore:c.notBefore,expiresAt:c.expiresAt,
        paidApiUsd:0,maxOperations:c.maxOperations,
        maxRequests:c.maxRequests,maxWrites:c.maxWrites};
      const effect={effectId:'req-'+randomUUID(),taskId,taskSha,
        headSha:authority.payload.baseSha,kind,method:descriptor.method,
        route:descriptor.route,payloadSha256:descriptor.payloadSha256,
        requestSha256:descriptor.requestSha256,
        envelopeDigest:c.digest,repo:c.repo,environment:c.environment,
        target:c.target,action:c.action};
      const result=await budget.reserve({envelope,effect,
        ...(descriptor.route==='graphql'?{readDescriptor:descriptor}:{})});
      must(result?.status==='RESERVED'&&result.reserved===true,
        'NATIVE_GITHUB_REQUEST_BUDGET_DENIED');
      must(await authority.revalidate()===true&&
        inspectStandingTransaction(transaction).transactionId===pinned.transactionId&&
        descriptor.signal?.aborted!==true,'NATIVE_GITHUB_ADMISSION_STALE');
      return true;
    };
    const next=pending.then(run);
    pending=next.then(()=>{},()=>{});
    return next;
  };
}
