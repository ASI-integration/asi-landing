import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {inspectSignedLiveUpgrade,inspectBegetLiveUpgradeReadiness} from './beget-active-upgrade-preflight.mjs';

const SHA=n=>n.repeat(40),H=n=>n.repeat(64);
const digest=s=>createHash('sha256').update(s).digest('hex');
const NOW=1793460000000;
const actions=[
  'verify-current-generation','preserve-existing-private-state',
  'stage-exact-new-generation','quiesce-existing-engine',
  'replace-existing-runtime-only','restart-same-engine',
  'verify-exact-new-generation-and-no-replay'
];
const fresh=()=>{
 const {privateKey,publicKey}=generateKeyPairSync('ed25519');
 const installed={
   schema:'asi.beget-engine-source.v1',sourceSha:SHA('a'),baseSha:SHA('b'),
   unitSha256:H('c'),catalogSha256:H('d'),installable:false,
   files:[]
 };
 const proposed={
   schema:'asi.beget-engine-source.v1',sourceSha:SHA('e'),baseSha:SHA('f'),
   unitSha256:H('c'),catalogSha256:H('0'),installable:false,
   files:Array.from({length:28},(_,i)=>({
     path:i===0?'scripts/strigunov4/execution-adapters/standing-request-guard.mjs':
          i===1?'scripts/strigunov4/execution-adapters/standing-budget.mjs':
          'scripts/strigunov4/execution-adapters/m'+i+'.mjs',
     sha256:H('a')
   }))
 };
 const oldRaw=JSON.stringify(installed)+'\n',newRaw=JSON.stringify(proposed)+'\n';
 const plan={
   schema:'asi.beget-active-upgrade-plan.v1',status:'SOURCE_CANDIDATE_ONLY',
   authorized:false,installable:false,
   old:{sourceSha:installed.sourceSha,catalogSha256:installed.catalogSha256,
     manifestSha256:digest(oldRaw)},
   proposed:{sourceSha:proposed.sourceSha,catalogSha256:proposed.catalogSha256,
     unitSha256:proposed.unitSha256,manifestSha256:digest(newRaw)},
   target:{service:'asi-strigunov-agent.service',runtime:'/opt/asi-engine',
     privateState:'/var/lib/asi-engine'}
 };
 const planRaw=JSON.stringify(plan)+'\n';
 const grant={
   schema:'asi.beget-active-upgrade-authorization.v1',host:'pqukibofpo',
   unit:'asi-strigunov-agent.service',oldManifestSha256:digest(oldRaw),
   newManifestSha256:digest(newRaw),newSourceSha:proposed.sourceSha,
   baseSha:proposed.baseSha,planSha256:digest(planRaw),
   actions,notBefore:NOW-1000,expiresAt:NOW+3600000
 };
 const signedGrantRaw=()=>JSON.stringify({payload:JSON.stringify(grant),
   signature:sign(null,Buffer.from(JSON.stringify(grant)),privateKey).toString('base64')});
 return {installedManifestRaw:oldRaw,proposedManifestRaw:newRaw,
   upgradePlanRaw:planRaw,signedGrantRaw:signedGrantRaw(),
   ownerPublicKey:publicKey.export({format:'pem',type:'spki'}),
   instance:{host:'pqukibofpo',unit:'asi-strigunov-agent.service',
     active:true,enabled:true,pid:387356,
     invocationId:'a'.repeat(32),restartCount:0},
   now:NOW,oldRaw,newRaw,plan,grant,privateKey,publicKey,signedGrantRawFor:signedGrantRaw
 };
};
const select=x=>Object.fromEntries([
 'installedManifestRaw','proposedManifestRaw','upgradePlanRaw','signedGrantRaw',
 'ownerPublicKey','instance','now'].map(k=>[k,x[k]]));
const inspect=x=>inspectSignedLiveUpgrade(select(x));
test('validly fixture-signed source upgrade never grants install or live authority',()=>{
 const x=fresh(),r=inspect(x);
 assert.equal(r.status,'SOURCE_SIGNATURE_VERIFIED');
 assert.equal(r.authorized,false);
 assert.equal(r.installable,false);
 assert.equal(r.hasLiveUpgrade,false);
 assert.equal(r.oldManifestSha256,digest(x.installedManifestRaw));
 assert.equal(r.newManifestSha256,digest(x.proposedManifestRaw));
 assert.equal(r.observedInvocationId,x.instance.invocationId);
});
test('signature from another owner signer or changed signed bytes fails closed',()=>{
 const x=fresh(),other=fresh();
 assert.equal(inspect({...x,ownerPublicKey:other.ownerPublicKey}).status,'BLOCKED');
 const forged=JSON.parse(x.signedGrantRaw);forged.payload+=' ';
 assert.equal(inspect({...x,signedGrantRaw:JSON.stringify(forged)}).status,'BLOCKED');
});
test('old manifest or new manifest mutation invalidates the exact grant',()=>{
 for(const key of ['installedManifestRaw','proposedManifestRaw']){
   const x=fresh();x[key]=x[key]+'\n';
   assert.equal(inspect(x).status,'BLOCKED');
 }
});
test('changed plan digest, path or target prevents signoff',()=>{
 const x=fresh();x.plan.target.runtime='/opt/not-authorized';
 x.upgradePlanRaw=JSON.stringify(x.plan)+'\n';
 assert.equal(inspect(x).status,'BLOCKED');
});
test('timestamp boundaries, host and unit changes cannot extend authority',()=>{
 for(const change of [
   x=>{x.now=x.grant.expiresAt},
   x=>{x.now=x.grant.notBefore-1},
   x=>{x.grant.expiresAt=x.grant.notBefore+15*86400000},
   x=>{x.grant.host='other-host'},
   x=>{x.grant.unit='fake-second-engine.service'}
 ]){
   const x=fresh();change(x);
   x.signedGrantRaw=x.signedGrantRawFor();
   assert.equal(inspect(x).status,'BLOCKED');
 }
});
test('forged grant action list cannot modify state scope',()=>{
 const x=fresh();x.grant.actions=[...actions.slice(0,2),'reset-ledger',...actions.slice(3)];
 x.signedGrantRaw=x.signedGrantRawFor();
 assert.equal(inspect(x).status,'BLOCKED');
});
test('unverified running process identity never yields source-ready',()=>{
 for(const change of [
  x=>{x.instance.active=false},
  x=>{x.instance.pid=0},
  x=>{x.instance.invocationId='fake'},
  x=>{x.instance.host='not-Beget'},
  x=>{x.instance.enabled=false},
 ]){
  const x=fresh();change(x);
  assert.equal(inspect(x).status,'BLOCKED');
 }
});
test('new source without standing guard must fail despite a valid signature',()=>{
 const x=fresh(),p=JSON.parse(x.proposedManifestRaw);
 p.files[0].path='scripts/strigunov4/execution-adapters/no-guard.mjs';
 x.proposedManifestRaw=JSON.stringify(p)+'\n';
 assert.equal(inspect(x).status,'BLOCKED');
});
test('untrusted source signature cannot fabricate operator identity',async()=>{
 const r=await inspectBegetLiveUpgradeReadiness({
   candidatePackage:'/tmp/not-an-authorized-upgrade',
   operatorUid:993,now:NOW
 });
 assert.equal(r.reason,'PRIVILEGED_OPERATOR_REQUIRED');
 assert.equal(r.authorized,false);
});
