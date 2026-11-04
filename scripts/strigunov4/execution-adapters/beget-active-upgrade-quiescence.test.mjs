import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {inspectUpgradeQuiescence} from './beget-active-upgrade-quiescence.mjs';

const h=s=>createHash('sha256').update(s).digest('hex');
const SHA='a'.repeat(40),HEX='b'.repeat(64),NOW=1793470000000;
const encoded=value=>{
  const bytes=JSON.stringify(value)+'\n';return {bytes,sha256:h(bytes)};
};
const fixture=()=>{
  const instance={host:'pqukibofpo',unit:'asi-strigunov-agent.service',
    active:true,enabled:true,pid:387356,invocationId:'d'.repeat(32),
    nRestarts:0,manifestSha256:HEX,sourceSha:SHA};
  const files={
    ledger:encoded({schemaVersion:'asi.execution-adapters.v1',
      mode:'IDLE',jobs:{}}),
    receipts:encoded({version:1,completed:[]}),
    heartbeat:encoded({mode:'WAITING',at:'2026-10-31T16:30:00Z'}),
    apiBudget:encoded({requests:0,mutations:0}),
    routingSha256:'c'.repeat(64)
  };
  const before={instance,files,executionLockPresent:false,
    publications:[],reports:[],capturedAtMs:NOW-4000};
  return {before,after:structuredClone({...before,capturedAtMs:NOW-2000}),nowMs:NOW};
};
test('empty IDLE Engine returns advisory only, never permission to stop',()=>{
  const out=inspectUpgradeQuiescence(fixture());
  assert.equal(out.status,'SOURCE_QUIESCENCE_CANDIDATE');
  assert.equal(out.authorized,false);assert.equal(out.installable,false);
  assert.equal(out.readyForStop,false);assert.equal(out.receiptCount,0);
});
test('lock present, in-flight ledger or unknown state blocks upgrade',()=>{
  for(const mutate of [
    x=>{x.after.executionLockPresent=true},
    x=>{x.after.files.ledger=encoded({schemaVersion:'asi.execution-adapters.v1',
      mode:'FAILED_LOCKED',reason:'IN_FLIGHT_OR_CRASHED',jobs:{}})},
    x=>{x.after.files.ledger=encoded({schemaVersion:'asi.execution-adapters.v1',
      mode:'IDLE',jobs:{task:{mode:'STARTED',sha:SHA}}})},
    x=>{x.after.files.heartbeat=encoded({mode:'RUNNING'})}
  ]){const x=fixture();mutate(x);assert.equal(inspectUpgradeQuiescence(x).status,'BLOCKED');}
});
test('changed budget, receipt, routing and process invalidate two captures',()=>{
  for(const mutate of [
    x=>{x.after.files.apiBudget=encoded({requests:1,mutations:0})},
    x=>{x.after.files.receipts=encoded({version:1,completed:[{id:'unbound'}]})},
    x=>{x.after.files.routingSha256='e'.repeat(64)},
    x=>{x.after.instance.pid=333},
    x=>{x.after.instance.invocationId='e'.repeat(32)},
    x=>{x.after.instance.nRestarts=1},
    x=>{x.after.instance.manifestSha256='f'.repeat(64)}
  ]){const x=fixture();mutate(x);assert.equal(inspectUpgradeQuiescence(x).status,'BLOCKED');}
});
test('old/stale/future captures cannot count as a stable window',()=>{
  for(const mutate of [
    x=>{x.after.capturedAtMs=x.before.capturedAtMs},
    x=>{x.after.capturedAtMs=x.before.capturedAtMs+300},
    x=>{x.after.capturedAtMs=NOW-65000},
    x=>{x.after.capturedAtMs=NOW+2},
    x=>{x.nowMs=0}
  ]){const x=fixture();mutate(x);assert.equal(inspectUpgradeQuiescence(x).status,'BLOCKED');}
});
test('provider may not forge source hash or JSON bytes',()=>{
  const x=fixture();
  x.after.files.ledger.sha256='f'.repeat(64);
  assert.equal(inspectUpgradeQuiescence(x).reason,'DURABLE_STATE_BYTES_UNVERIFIED');
  const y=fixture();
  y.before.files.receipts.bytes='not-json';
  assert.equal(inspectUpgradeQuiescence(y).status,'BLOCKED');
});
function published(x){
  const id='beget-g2-witness-identity-v1',report=id+'-one.txt';
  const reportBytes=JSON.stringify({task:id,sha:SHA,kind:'github-publisher'})+'\n';
  const reportSha=h(reportBytes);
  const ledger={schemaVersion:'asi.execution-adapters.v1',mode:'IDLE',
    jobs:{[id]:{mode:'PUBLISHED',kind:'github-publisher',sha:SHA,pr:null,
      report,reportSha256:reportSha}}};
  const receipts={version:1,completed:[{id,sha:SHA,pr:null,status:'PASS',
    kind:'github-publisher',report,reportSha256:reportSha}]};
  const pub=encoded({version:1,phase:'VERIFIED',kind:'github-publisher',
    baseSha:SHA,taskBinding:HEX});
  for(const s of [x.before,x.after]){
    s.files.ledger=encoded(ledger);s.files.receipts=encoded(receipts);
    s.publications=[{taskId:id,name:'publication-'+id+'.json',...pub}];
    s.reports=[{name:report,bytes:reportBytes,sha256:reportSha}];
  }
}
test('completed publisher record with exact matched journal and report is advisory',()=>{
  const x=fixture();published(x);
  const r=inspectUpgradeQuiescence(x);
  assert.equal(r.status,'SOURCE_QUIESCENCE_CANDIDATE');
  assert.equal(r.receiptCount,1);
  assert.equal(r.readyForStop,false);
});
test('INTENT, WAITING or missing publication history denies old write replay',()=>{
  for(const phase of ['INTENT','PUBLISHED_WAITING','FAILED','UNVERIFIED']){
    const x=fixture();published(x);
    x.after.publications[0].bytes=JSON.stringify({...JSON.parse(x.after.publications[0].bytes),phase})+'\n';
    x.after.publications[0].sha256=h(x.after.publications[0].bytes);
    assert.equal(inspectUpgradeQuiescence(x).reason,'REMOTE_PUBLICATION_OUTCOME_UNKNOWN');
  }
  const y=fixture();published(y);y.after.publications=[];
  assert.equal(inspectUpgradeQuiescence(y).reason,'PUBLICATION_JOURNAL_INCOMPLETE');
});
test('missing, duplicated or tampered reports deny source quiescence',()=>{
  for(const mutate of [
    x=>{x.after.reports=[]},
    x=>{x.after.reports[0].bytes+='modified'},
    x=>{x.after.reports[0].sha256='a'.repeat(64)},
    x=>{x.after.reports[0].name='other.txt'}
  ]){const x=fixture();published(x);mutate(x);
    assert.equal(inspectUpgradeQuiescence(x).status,'BLOCKED');}
});
test('ledger contains historical FAILED or nonpublisher job: cannot silently clear',()=>{
  const x=fixture();
  x.after.files.ledger=encoded({schemaVersion:'asi.execution-adapters.v1',
    mode:'IDLE',jobs:{bad:{mode:'FAILED_LOCKED',kind:'github-publisher',sha:SHA}}});
  assert.equal(inspectUpgradeQuiescence(x).reason,'UNSETTLED_OR_CORRUPT_JOB');
});
test('new terminal receipt without matching ledger job is blocked',()=>{
  const x=fixture();
  x.after.files.receipts=encoded({version:1,completed:[{
    id:'unknown',sha:SHA,pr:null,status:'PASS',kind:'github-publisher',
    report:'unknown.txt',reportSha256:HEX}]});
  assert.equal(inspectUpgradeQuiescence(x).reason,'UNSETTLED_OR_UNKNOWN_RECEIPT');
});
