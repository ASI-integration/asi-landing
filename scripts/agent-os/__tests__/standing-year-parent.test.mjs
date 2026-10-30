import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {inspectStandingYearLease as inspect,PARENT_MAX_MS,CHILD_MAX_MS} from '../standing-year-parent.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const mkkey=()=>{const k=generateKeyPairSync('ed25519');return {...k,
  pem:k.publicKey.export({type:'spki',format:'pem'}),
  pin:hash(k.publicKey.export({type:'spki',format:'der'}))};};
const signPayload=(o,k,domain)=>{const payload=JSON.stringify(o);return {
  payload,signature:sign(null,Buffer.concat([Buffer.from(domain),Buffer.from([0]),Buffer.from(payload)]),
   k.privateKey).toString('base64')};};
const NOW=1793350000000;
const lanes=[
['engine','asi/beget-one-engine-20261028'],['ru-auth','feat/ru-unified-auth-20261029'],
['p0-integration','asi/standing-delegation-551'],
['p0-trust','asi/p0-trusted-evidence-worker-20261029'],
['p0-atomic-budget','asi/p0-atomic-budget-worker-20261029']
].map(([id,branch])=>({id,branch}));
function f(){
  const owner=mkkey(),issuer=mkkey();
  const parent={schema:'asi.standing-owner-parent.v1',repository:'ASI-integration/asi-landing',
    host:'pqukibofpo',ownerId:207600140,ownerKeySha256:owner.pin,
    childIssuerKeySha256:issuer.pin,notBefore:NOW-1000,
    expiresAt:NOW-1000+PARENT_MAX_MS,ledgerId:'standing-ledger-2026',
    lanes,maxRequests:5000,maxWrites:100,maxTasks:5,paidUsd:0,revocationSequence:3};
  const c={schema:'asi.standing-child-lease.v1',parentSha256:'',
    repository:parent.repository,host:parent.host,ledgerId:parent.ledgerId,sequence:1,
    notBefore:NOW-1000,expiresAt:NOW-1000+CHILD_MAX_MS,
    lanes:['engine','p0-integration'],maxRequests:500,maxWrites:10,maxTasks:2,
    paidUsd:0,revocationSequence:3};
  const ledger={ledgerId:parent.ledgerId,parentSha256:'',
    revocationSequence:3,requestsUsed:5,writesUsed:1,tasksUsed:1,
    latestLeaseSequence:0,latestLeaseSha256:null};
  const args={ownerPublicKey:owner.pem,issuerPublicKey:issuer.pem,
    pinnedOwnerKeySha256:owner.pin,pinnedIssuerKeySha256:issuer.pin,
    trustedLedger:ledger,revokedParentDigests:[],now:NOW};
  function run(){const pe=signPayload(parent,owner,'ASI_STANDING_PARENT_V1');
    c.parentSha256=hash(pe.payload);ledger.parentSha256=c.parentSha256;
    const ce=signPayload(c,issuer,'ASI_STANDING_CHILD_V1');
    return inspect({...args,parentEnvelope:pe,childEnvelope:ce});}
  return {parent,c,ledger,args,run,owner,issuer};
}
test('365 day signed parent with 14 day signed child is source eligible and NEVER an execution grant',()=>{
 const x=f().run();assert.equal(x.status,'SOURCE_POLICY_ELIGIBLE');assert.equal(x.authorized,false);
 assert.equal(x.executionAllowed,false);assert.equal(x.automaticRenewalPerformed,false);
 assert.deepEqual(x.remainingBudget,{requests:4995,writes:99,tasks:4});
});
test('365+1 parent days rejected',()=>{const x=f();x.parent.expiresAt++;assert.equal(x.run().status,'BLOCKED')});
test('14+1 child days rejected',()=>{const x=f();x.c.expiresAt++;assert.equal(x.run().reason,'CHILD_SCOPE_OR_EXPIRY')});
test('expired parent rejected even when child superficially valid',()=>{const x=f();x.parent.expiresAt=NOW;assert.equal(x.run().status,'BLOCKED')});
test('expired child rejected',()=>{const x=f();x.c.expiresAt=NOW;assert.equal(x.run().status,'BLOCKED')});
test('child crossing parent endpoint rejected',()=>{const x=f();x.parent.expiresAt=NOW+100;assert.equal(x.run().reason,'CHILD_SCOPE_OR_EXPIRY')});
test('revoked parent rejected',()=>{const x=f();const pe=signPayload(x.parent,x.owner,'ASI_STANDING_PARENT_V1');x.args.revokedParentDigests=[hash(pe.payload)];assert.equal(x.run().reason,'PARENT_REVOKED_OR_REVOCATION_UNKNOWN')});
test('untrusted/missing issuer pin rejected',()=>{const x=f();x.args.pinnedIssuerKeySha256='a'.repeat(64);assert.equal(x.run().status,'BLOCKED')});
test('child unknown lane rejected',()=>{const x=f();x.c.lanes=['engine','unknown'];assert.equal(x.run().reason,'CHILD_SCOPE_OR_EXPIRY')});
test('child budget expansion rejected',()=>{const x=f();x.c.maxRequests=5001;assert.equal(x.run().reason,'CHILD_SCOPE_OR_EXPIRY')});
test('new child lease cannot reset durable parent request count',()=>{const x=f();x.ledger.requestsUsed=0;const y=x.run();assert.equal(y.authorized,false);assert.equal(y.automaticRenewalPerformed,false)});
test('lost durable ledger rejected',()=>{const x=f();x.args.trustedLedger=undefined;assert.equal(x.run().reason,'DURABLE_LEDGER_OR_REPLAY_UNVERIFIED')});
test('ledger ID mismatch rejected',()=>{const x=f();x.ledger.ledgerId='other-ledger-2026';assert.equal(x.run().reason,'DURABLE_LEDGER_OR_REPLAY_UNVERIFIED')});
test('replayed previous child after advance rejected',()=>{const x=f();x.ledger.latestLeaseSequence=2;x.ledger.latestLeaseSha256='a'.repeat(64);assert.equal(x.run().reason,'DURABLE_LEDGER_OR_REPLAY_UNVERIFIED')});
test('same sequence with different bytes rejected',()=>{const x=f();x.ledger.latestLeaseSequence=1;x.ledger.latestLeaseSha256='a'.repeat(64);assert.equal(x.run().reason,'DURABLE_LEDGER_OR_REPLAY_UNVERIFIED')});
test('new short child can be verified after first expired without extending parent or renewing itself',()=>{
 const x=f(),first=x.run();x.ledger.latestLeaseSequence=1;x.ledger.latestLeaseSha256=first.childSha256;
 x.c.sequence=2;x.c.notBefore=NOW+13*86400000;x.c.expiresAt=x.c.notBefore+CHILD_MAX_MS;
 x.args.now=x.c.notBefore+1000;
 const second=x.run();assert.equal(second.status,'SOURCE_POLICY_ELIGIBLE');
 assert.equal(second.authorized,false);assert.notEqual(second.childSha256,first.childSha256);
});
test('tampered Ed25519 child signature rejected',()=>{
 const x=f(),pe=signPayload(x.parent,x.owner,'ASI_STANDING_PARENT_V1');
 x.c.parentSha256=hash(pe.payload);x.ledger.parentSha256=x.c.parentSha256;
 const ce=signPayload(x.c,x.issuer,'ASI_STANDING_CHILD_V1');
 ce.signature='A'+ce.signature.slice(1);
 assert.equal(inspect({...x.args,parentEnvelope:pe,childEnvelope:ce}).status,'BLOCKED');
});
