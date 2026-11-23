import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {OWNER_LANES} from './owner-lanes.mjs';
import {inspectEngineRestart,projectObservedFiveLanes} from './autonomy-recovery-observer.mjs';

const SHA=n=>n.repeat(40), H=n=>n.repeat(64);
const sum=s=>createHash('sha256').update(s).digest('hex');
const SYSTEM={unit:'asi-strigunov-agent.service',active:true,pid:387356,
  invocationId:'a'.repeat(32),nRestarts:0};
const NEXT={...SYSTEM,pid:400700,invocationId:'b'.repeat(32),nRestarts:1};
const task=(n)=>({id:'g2-witness-'+n,sha:SHA(n),pr:n==='a'?564:565});
const make=()=>{
  const records={};
  const receipts=['a','b'].map((id,i)=>{
    const item=task(id);
    const raw=JSON.stringify({
      task:item.id,sha:item.sha,pr:null,kind:'github-publisher',
      result:{artifactType:'GITHUB_PR_VERIFIED',taskBinding:H('c'),pr:item.pr,head:SHA(id)}
    })+'\n';
    const name=item.id+'.txt';
    records[name]=raw;
    return {id:item.id,sha:item.sha,pr:null,kind:'github-publisher',
      status:'PASS',report:name,reportSha256:sum(raw)};
  });
  const digests={receipts:H('d'),budget:H('e'),routing:H('f')};
  return {before:{systemd:{...SYSTEM},receipts:structuredClone(receipts),
      digests:{...digests},reports:{}},
    after:{systemd:{...NEXT},receipts:structuredClone(receipts),
      digests:{...digests},reports:{}},reportBytes:records};
};
test('two exact receipts and unchanged budgets survive simulated controlled restart',()=>{
  const result=inspectEngineRestart(make());
  assert.equal(result.status,'SOURCE_INTEGRITY_READY');
  assert.equal(result.restartObserved,true);
  assert.equal(result.receipts.length,2);
  assert.equal(result.verified,false);
  assert.equal(result.physicalAcceptance,false);
  assert.equal(result.liveAuthority,false);
});
test('same PID or invocation cannot claim restart physical acceptance',()=>{
  const evidence=make();evidence.after.systemd={...SYSTEM};
  assert.equal(inspectEngineRestart(evidence).status,'RESTART_NOT_OBSERVED');
  evidence.after.systemd={...NEXT,invocationId:SYSTEM.invocationId};
  assert.equal(inspectEngineRestart(evidence).status,'RESTART_NOT_OBSERVED');
});
test('receipt add/removal or PR substitution cannot pass without being detected',()=>{
  const a=make();a.after.receipts.push({...a.after.receipts[0],id:'extra'});
  assert.equal(inspectEngineRestart(a).status,'BLOCKED');
  const b=make();b.after.receipts[0].pr+=1;
  assert.equal(inspectEngineRestart(b).reason,'RECEIPT_IDENTITY_OR_REPLAY_CHANGED');
  const c=make();c.after.receipts.reverse();
  assert.equal(inspectEngineRestart(c).status,'BLOCKED');
});
test('budget, routing, or receipt-state digest changes block recovery',()=>{
  for(const type of ['budget','routing','receipts']){
    const e=make();e.after.digests[type]=H('0');
    assert.equal(inspectEngineRestart(e).reason,'PERSISTENT_RECEIPT_BUDGET_OR_ROUTING_CHANGED',type);
  }
});
test('tampered reports, task identities and fake CI artifact cannot count as proof',()=>{
  const e=make();e.reportBytes['g2-witness-a.txt']+='x';
  assert.equal(inspectEngineRestart(e).reason,'REPORT_HASH_OR_TASK_BINDING_UNVERIFIED');
  const f=make();f.reportBytes['g2-witness-a.txt']=f.reportBytes['g2-witness-b.txt'];
  assert.equal(inspectEngineRestart(f).status,'BLOCKED');
  const g=make(),s=JSON.parse(g.reportBytes['g2-witness-a.txt']);
  s.result.artifactType='SOURCE_ONLY';
  g.reportBytes['g2-witness-a.txt']=JSON.stringify(s)+'\n';
  g.before.receipts[0].reportSha256=sum(g.reportBytes['g2-witness-a.txt']);
  g.after.receipts[0].reportSha256=g.before.receipts[0].reportSha256;
  assert.equal(inspectEngineRestart(g).status,'BLOCKED');
});
test('no two terminal receipts cannot be upgraded to physical proof',()=>{
  const e=make();e.before.receipts.length=1;e.after.receipts.length=1;
  assert.equal(inspectEngineRestart(e).reason,'TWO_TERMINAL_RECEIPTS_MISSING_OR_CHANGED');
});
test('bad systemd unit or declined restart counter never yields READY',()=>{
  const a=make();a.after.systemd.unit='fake-second-engine.service';
  assert.equal(inspectEngineRestart(a).status,'BLOCKED');
  const b=make();b.before.systemd.nRestarts=5;b.after.systemd.nRestarts=1;
  assert.equal(inspectEngineRestart(b).reason,'SYSTEMD_RESTART_COUNTER_REGRESSED');
});
test('sparse objects and getter-backed reports do not become trusted facts',()=>{
  const a=make();Object.defineProperty(a.reportBytes,'g2-witness-a.txt',{get(){throw Error('secret')}});
  assert.equal(inspectEngineRestart(a).status,'BLOCKED');
  const b=make();b.before.receipts[0].id='../escape';
  assert.equal(inspectEngineRestart(b).status,'BLOCKED');
});
test('five lanes without signed admission remain BLOCKED, never falsely RUNNING',()=>{
  const observed=projectObservedFiveLanes({systemd:SYSTEM,catalog:[
    {id:'g2-only',sha:SHA('a'),repo:'ASI-integration/asi-landing',
      branch:'asi/approved-g2'}],heartbeats:{},nowMs:1793350000000});
  assert.equal(observed.lanes.length,5);
  assert(observed.lanes.every(l=>l.status==='BLOCKED'));
  assert.equal(observed.verified,false);
});
test('fresh instance-bound heartbeat only yields OBSERVED status, not verified',()=>{
  const catalog=OWNER_LANES.map((l,i)=>({
    id:'lane-'+i,sha:String(i+1).repeat(40),repo:l.repository,branch:l.branch
  }));
  const now=1793350000000;
  const heartbeats=Object.fromEntries(OWNER_LANES.map((l,i)=>[
    l.id,{taskId:catalog[i].id,taskSha:catalog[i].sha,
      pid:SYSTEM.pid,invocationId:SYSTEM.invocationId,atMs:now-3000,
      mode:i===0?'RUNNING':i===1?'BLOCKED':'IDLE'}
  ]));
  const evidence=projectObservedFiveLanes({systemd:SYSTEM,catalog,heartbeats,nowMs:now});
  assert.equal(evidence.lanes[0].status,'OBSERVED_RUNNING');
  assert.equal(evidence.lanes[1].status,'BLOCKED');
  assert.equal(evidence.lanes[2].status,'OBSERVED_IDLE');
  assert.equal(evidence.verified,false);
  assert.equal(evidence.liveAuthority,false);
});
test('stale or foreign-PID heartbeat is UNKNOWN, never silently accepted',()=>{
  const catalog=[{id:'lane-engine',sha:SHA('a'),repo:OWNER_LANES[0].repository,
    branch:OWNER_LANES[0].branch}],now=1793350000000;
  const h={engine:{taskId:'lane-engine',taskSha:SHA('a'),atMs:now-16*60*1000,
    pid:SYSTEM.pid,invocationId:SYSTEM.invocationId,mode:'RUNNING'}};
  assert.equal(projectObservedFiveLanes({systemd:SYSTEM,catalog,heartbeats:h,nowMs:now}).lanes[0].status,'UNKNOWN');
  h.engine.atMs=now-3000;h.engine.pid=999;
  assert.equal(projectObservedFiveLanes({systemd:SYSTEM,catalog,heartbeats:h,nowMs:now}).lanes[0].status,'UNKNOWN');
});
test('missing native instance or malformed catalog cannot generate live statuses',()=>{
  const result=projectObservedFiveLanes({systemd:{...SYSTEM,active:false},
    catalog:[],heartbeats:{},nowMs:1793350000000});
  assert(result.lanes.every(l=>l.status==='UNKNOWN'));
  assert.equal(result.verified,false);
});
