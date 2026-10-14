import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {SOURCE_SHA,PREVIEW_COMMANDS,newPreviewLedger,inspectPreviewCheckpoint,
 inspectPreviewRequest,stepPreviewLedger,restorePreviewCheckpoint}
 from '../acceptance/strigunov-task24-offline-broker.mjs';

const RUN='strig-t24-123456789abc',HASH='a'.repeat(64),NOW=1791997200000;
const make=()=>newPreviewLedger({runId:RUN,manifestSha256:HASH});
const request=(operation,sequence,changes={})=>JSON.stringify({
 kind:'ASI_TASK24_PREVIEW_V1',runId:RUN,sourceSha:SOURCE_SHA,
 manifestSha256:HASH,sequence,requestId:sequence.toString(16).padStart(32,'0'),
 command:operation,scope:'SYNTHETIC_ONLY',issuedAtMs:NOW-1000,
 expiresAtMs:NOW+30000,observation:'OBSERVED',...changes
});
const step=(ledger,op,seq,changes={})=>stepPreviewLedger(ledger,request(op,seq,changes),NOW);
const blocked=x=>{
 assert.equal(x.status,'HOLD');
 for(const k of ['authorized','canIssueReceipt','canInstall','canApprove','canSend',
  'canAccessProduction','canRetryUnknownCommit'])assert.equal(x[k],false,k);
};
test('starts with a strictly synthetic, untrusted preview ledger',()=>{
 const l=make();assert.equal(l.state,'OPEN');assert.equal(l.index,0);
 assert.equal(l.sequence,0);assert.equal(inspectPreviewCheckpoint(l).status,'SHAPE_ONLY');
 assert.equal(inspectPreviewCheckpoint(l).trusted,false);
});
test('only six fixed commands are accepted in order; no real execution',()=>{
 let l=make();for(let i=0;i<PREVIEW_COMMANDS.length;i++){
  const v=step(l,PREVIEW_COMMANDS[i],i+1);
  assert.equal(v.status,'PREVIEW_ADVANCED');assert.equal(v.authorized,false);
  assert.equal(v.canSend,false);l=v.ledger;
 }
 assert.equal(l.state,'CLOSED');assert.equal(l.sequence,6);
 blocked(step(l,'inspect-owned-host',7));
});
test('requests are shapes, never independently authenticated',()=>{
 const v=inspectPreviewRequest(request(PREVIEW_COMMANDS[0],1));
 assert.equal(v.status,'SHAPE_ONLY');assert.equal(v.trusted,false);
 assert.equal(v.authorized,false);
});
test('wrong first operation remains blocked without consuming a sequence',()=>{
 const l=make(),v=step(l,'readonly-reconcile',1);
 blocked(v);assert.equal(v.ledger,l);
});
test('repeated request ID and sequence fail closed',()=>{
 const l=step(make(),PREVIEW_COMMANDS[0],1).ledger;
 blocked(step(l,PREVIEW_COMMANDS[1],1));
 blocked(step(l,PREVIEW_COMMANDS[1],2,{requestId:'1'.padStart(32,'0')}));
 assert.equal(l.sequence,1);
});
test('sequence gaps cannot be skipped',()=>{
 const l=step(make(),PREVIEW_COMMANDS[0],1).ledger;
 blocked(step(l,PREVIEW_COMMANDS[1],3));
});
test('cannot switch identity, manifest or source',()=>{
 const l=make(),edits=[
  {runId:'strig-t24-aaaaaaaaaaaa'},
  {manifestSha256:'b'.repeat(64)},
  {sourceSha:'f'.repeat(40)}
 ];
 for(const edit of edits)blocked(step(l,PREVIEW_COMMANDS[0],1,edit));
});
test('manual clock must be inside the narrow TTL window',()=>{
 const l=make(),r=request(PREVIEW_COMMANDS[0],1);
 for(const t of [NOW-2000,NOW+30000,0,NaN,'now'])
  blocked(stepPreviewLedger(l,r,t));
});
test('post-COMMIT unknown outcome is HOLD, not replayable',()=>{
 const v=step(make(),PREVIEW_COMMANDS[0],1,{observation:'COMMIT_UNCERTAIN'});
 blocked(v);assert.equal(v.ledger.state,'HOLD');assert.equal(v.ledger.sequence,1);
 blocked(step(v.ledger,PREVIEW_COMMANDS[0],2));
});
test('even alleged read-only reconciliation never releases HOLD',()=>{
 const first=step(make(),PREVIEW_COMMANDS[0],1,{observation:'COMMIT_UNCERTAIN'}).ledger;
 const second=step(first,'readonly-reconcile',2);
 blocked(second);assert.equal(second.ledger.state,'HOLD');
 assert.equal(second.ledger.sequence,2);
 assert.equal(second.ledger.index,0);
});
test('cleanup operation in HOLD remains no-authority',()=>{
 const l=step(make(),PREVIEW_COMMANDS[0],1,{observation:'DENIED'}).ledger;
 const v=step(l,'stop-owned-lab',2);
 blocked(v);assert.equal(v.ledger.state,'HOLD');
});
test('untrusted restart snapshot cannot authorize or send',()=>{
 const l=step(make(),PREVIEW_COMMANDS[0],1).ledger;
 const restored=restorePreviewCheckpoint(JSON.stringify(l));
 assert.equal(restored.status,'SHAPE_ONLY');
 assert.equal(restored.authorized,false);assert.equal(restored.canSend,false);
 blocked(step(restored.ledger,PREVIEW_COMMANDS[0],1));
 const next=step(restored.ledger,PREVIEW_COMMANDS[1],2);
 assert.equal(next.status,'PREVIEW_ADVANCED');assert.equal(next.authorized,false);
});
test('untrusted checkpoint rollback is never an authority receipt',()=>{
 const l=step(make(),PREVIEW_COMMANDS[0],1).ledger;
 const old=restorePreviewCheckpoint(JSON.stringify(make()));
 assert.equal(old.status,'SHAPE_ONLY');assert.equal(old.authorized,false);
 assert.equal(old.reason,'REQUIRES_OWNER_CONTROLLED_DURABLE_LEDGER');
 assert.equal(l.sequence,1);
});
test('unknown checkout fields must be refused',()=>{
 const l={...make(),canSend:true};
 assert.equal(inspectPreviewCheckpoint(l).status,'HOLD');
 blocked(stepPreviewLedger(l,request(PREVIEW_COMMANDS[0],1),NOW));
});
test('checkpoint duplicate processed IDs cannot hide replay',()=>{
 const x={...make(),sequence:2,index:2,processed:['1'.padStart(32,'0'),'1'.padStart(32,'0')]};
 assert.equal(inspectPreviewCheckpoint(x).status,'HOLD');
});
test('checkpoint indexes and state must be consistent',()=>{
 for(const x of [
  {...make(),index:7},{...make(),state:'CLOSED'},
  {...make(),state:'OPEN',index:6},{...make(),sequence:1},
  {...make(),schema:2},{...make(),processed:'1'},
  {...make(),manifestSha256:'bad'}
 ])assert.equal(inspectPreviewCheckpoint(x).status,'HOLD');
});
test('invalid scope fails to create a model',()=>{
 for(const input of [
  {runId:RUN,manifestSha256:'bad'},
  {runId:'strig-t24-x',manifestSha256:HASH},
  {runId:RUN,manifestSha256:HASH,sourceSha:'b'.repeat(40)}
 ])assert.throws(()=>newPreviewLedger(input));
});
test('opaque extra fields and arbitrary commands are denied',()=>{
 const l=make();
 const x=JSON.parse(request(PREVIEW_COMMANDS[0],1));
 x.shell='curl prod';blocked(stepPreviewLedger(l,JSON.stringify(x),NOW));
 const arbitrary=request('exec-shell',1);
 blocked(stepPreviewLedger(l,arbitrary,NOW));
});
test('command vocabulary cannot include operator issue or guest send',()=>{
 assert.deepEqual(PREVIEW_COMMANDS,[
  'inspect-owned-host','verify-immutable-release','read-technical-phase1',
  'verify-operator-revocation','readonly-reconcile','stop-owned-lab'
 ]);
});
test('malformed request bytes and JSON fail closed',()=>{
 const l=make();
 for(const raw of ['',null,'not-json','{}','x'.repeat(4096),'[]'])
  blocked(stepPreviewLedger(l,raw,NOW));
});
test('invalid required field types cannot be coerced',()=>{
 const l=make();
 for(const fields of [
  {sequence:'1'},{scope:'PRODUCTION'},{observation:'SUCCESS'},
  {expiresAtMs:NOW+3600000},{issuedAtMs:'date'},
  {requestId:'incorrect'},{kind:'ASI_TASK24_GRANT_V1'},
  {manifestSha256:null}
 ])blocked(step(l,PREVIEW_COMMANDS[0],1,fields));
});
test('an unknown outcome cannot run a new write after alleged reconciliation',()=>{
 let l=step(make(),PREVIEW_COMMANDS[0],1,{observation:'COMMIT_UNCERTAIN'}).ledger;
 l=step(l,'readonly-reconcile',2).ledger;
 blocked(step(l,'verify-immutable-release',3));
});
test('restored invalid checkpoints are fail-closed',()=>{
 for(const raw of [null,'bad-json','[]','{}','x'.repeat(4097)])
  blocked(restorePreviewCheckpoint(raw));
});
test('a future fake caller grant flag is forbidden',()=>{
 const l=make(),r=JSON.parse(request(PREVIEW_COMMANDS[0],1));
 r.ownerApproved=true;blocked(stepPreviewLedger(l,JSON.stringify(r),NOW));
});
test('array-wrapped replay IDs never pass checkpoint restore',()=>{
 const l=step(make(),PREVIEW_COMMANDS[0],1).ledger;
 const tampered={...l,processed:[[l.processed[0]]]};
 const v=restorePreviewCheckpoint(JSON.stringify(tampered));
 blocked(v);assert.equal(v.ledger,null);
 assert.equal(inspectPreviewCheckpoint(tampered).status,'HOLD');
});
test('array-wrapped run, request, or digest cannot impersonate a string',()=>{
 const l=make();
 for(const [key,value] of [
  ['runId',[RUN]],['requestId',['1'.padStart(32,'0')]],
  ['manifestSha256',[HASH]]
 ]){
  const obj=JSON.parse(request(PREVIEW_COMMANDS[0],1));
  obj[key]=value;blocked(stepPreviewLedger(l,JSON.stringify(obj),NOW));
 }
 assert.throws(()=>newPreviewLedger({runId:[RUN],manifestSha256:HASH}));
 assert.throws(()=>newPreviewLedger({runId:RUN,manifestSha256:[HASH]}));
 const malformed={...make(),manifestSha256:[HASH]};
 assert.equal(inspectPreviewCheckpoint(malformed).status,'HOLD');
});
test('no cloud, network, filesystem, SQL, secret or sending capabilities',()=>{
 const src=readFileSync('scripts/acceptance/strigunov-task24-offline-broker.mjs','utf8');
 assert.doesNotMatch(src,/\bimport\s|require\s*\(|process\.env|fetch\s*\(|execFileSync|spawn\s*\(|\.query\s*\(|createServer|\.writeFile/);
 assert.doesNotMatch(src,/https?:\/\/|GITHUB_TOKEN|HETZNER_API_TOKEN|sendGuest|sendTelegram/);
});
test('CodeRabbit Autofix remains explicitly disabled in main',()=>{
 const c=readFileSync('.coderabbit.yaml','utf8');
 assert.match(c,/reviews:\s*\n\s*finishing_touches:\s*\n\s*autofix:\s*\n\s*enabled: false/);
});
