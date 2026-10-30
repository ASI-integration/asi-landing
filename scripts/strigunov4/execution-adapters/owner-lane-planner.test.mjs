import test from 'node:test';
import assert from 'node:assert/strict';
import {minimumBackoffMs,planCooperativeOwnerLane} from './owner-lane-planner.mjs';

const REPO='ASI-integration/asi-landing', NOW=1793340000000;
const names=[
  ['engine','asi/beget-one-engine-20261028'],
  ['ru-auth','feat/ru-unified-auth-20261029'],
  ['p0-integration','asi/standing-delegation-551'],
  ['p0-trust','asi/p0-trusted-evidence-worker-20261029'],
  ['p0-atomic-budget','asi/p0-atomic-budget-worker-20261029'],
];
const lanes=names.map(([id,branch])=>({id,repository:REPO,branch}));
const tasks=lanes.map((lane,i)=>({id:`task-${i}`,repo:REPO,branch:lane.branch,stage:'S4-G2',kind:'github-publisher',
  sha:String(i+1).repeat(40),changes:[{path:`docs/engine-lanes/test-${i}.txt`}] }));
const journal=()=>({schema:'asi.beget-owner-lane-journal.v1',engineMode:'IDLE',lanes:Object.fromEntries(
  lanes.map((lane,i)=>[lane.id,{mode:'READY',taskId:tasks[i].id,taskSha:tasks[i].sha,
    lastServedAtMs:0,nextEligibleAtMs:0,retries:0}]))});
const make=(overrides={})=>({laneDefinitions:lanes,admittedCatalog:tasks,journal:journal(),nowMs:NOW,...overrides});
const choose=s=>planCooperativeOwnerLane(s);

test('zero live privileges: never returns an execution grant or verified server status',()=>{
  const result=choose(make());
  assert.equal(result.kind,'CANDIDATE');
  assert.equal(result.authority,'NONE_SOURCE_ONLY');
  assert.equal(result.candidate.laneId,'engine');
  assert.equal(Object.isFrozen(result),true);
  assert.equal(JSON.stringify(result).includes('VERIFIED RUNNING'),false);
});
test('rejects absent and malformed catalog input and caller lane definitions',()=>{
  assert.equal(choose(make({admittedCatalog:null})).kind,'UNKNOWN');
  assert.equal(choose(make({admittedCatalog:[]})).kind,'UNKNOWN');
  assert.equal(choose(make({laneDefinitions:[...lanes,{id:'evil',repository:REPO,branch:'new'}]})).kind,'UNKNOWN');
  assert.equal(choose(make({laneDefinitions:[...lanes.slice(0,4),{...lanes[4],branch:lanes[3].branch}]})).kind,'UNKNOWN');
  assert.equal(choose(make({nowMs:NaN})).kind,'UNKNOWN');
});
test('the historical two-witness catalog adds no authority to five owner branches',()=>{
  const witness=[{...tasks[0],id:'g2-witness',branch:'asi/approved-only-g2'}];
  const result=choose(make({admittedCatalog:witness}));
  assert.equal(result.kind,'NONE');
  assert.equal(result.lanes.length,5);
  assert.ok(result.lanes.every(l=>l.reason==='NOT_IN_SIGNED_EXECUTION_CATALOG'));
});
test('candidate fairness rotates least recently served under the SAME serial writer',()=>{
  const state=journal();state.lanes.engine.lastServedAtMs=NOW-1000;
  assert.equal(choose(make({journal:state})).candidate.laneId,'ru-auth');
  state.lanes['ru-auth'].lastServedAtMs=NOW-900;
  assert.equal(choose(make({journal:state})).candidate.laneId,'p0-integration');
});
test('one blocked lane never grants it a turn or blocks disjoint admitted work',()=>{
  const state=journal();state.lanes.engine.mode='BLOCKED';
  const result=choose(make({journal:state}));
  assert.equal(result.candidate.laneId,'ru-auth');
  assert.equal(result.lanes[0].reason,'NO_AUTOMATIC_RETRY');
});
test('crash uncertainty or FAILED_LOCKED is a global stop, not cooperative bypass',()=>{
  const state=journal();state.engineMode='FAILED_LOCKED';
  assert.equal(choose(make({journal:state})).kind,'STOPPED');
  state.engineMode='IDLE';state.lanes.engine.mode='FAILED_LOCKED';
  assert.equal(choose(make({journal:state})).kind,'STOPPED');
  state.lanes.engine.mode='UNKNOWN';
  assert.equal(choose(make({journal:state})).reason,'LANE_UNKNOWN_REQUIRES_RECONCILIATION');
});
test('retry backoff is capped, no early lease or stale task identity is eligible',()=>{
  assert.equal(minimumBackoffMs(1),60000);
  assert.equal(minimumBackoffMs(7),3600000);
  assert.equal(minimumBackoffMs(8),null);
  const state=journal();state.lanes.engine={...state.lanes.engine,mode:'BACKOFF',retries:3,
    lastServedAtMs:NOW-10000,nextEligibleAtMs:NOW+230000};
  assert.equal(choose(make({journal:state})).candidate.laneId,'ru-auth');
  state.lanes.engine.nextEligibleAtMs=NOW-5000;
  assert.equal(choose(make({journal:state})).reason,'BACKOFF_BYPASS_OR_INVALID');
  state.lanes.engine.taskSha='f'.repeat(40);
  assert.equal(choose(make({journal:state})).reason,'DURABLE_LANE_IDENTITY_OR_STATE_INVALID');
});
test('never selects duplicate task, colliding path, outside stage or unsafe path',()=>{
  for(const mutation of [
    t=>t.push({...t[0]}),
    t=>t[1].id=t[0].id,
    t=>t[1].changes[0].path=t[0].changes[0].path,
    t=>t[0].changes[0].path='docs/engine-lanes',
    t=>t[0].changes[0].path='.git/config',
    t=>t[0].changes[0].path='.',
    t=>t[0].changes[0].path='docs/engine-lanes/.',
    t=>t[0].changes[0].path='docs/./engine-lanes/test-0.txt',
    t=>t[0].changes[0].path='docs/.GIT/hooks/pre-commit',
    t=>t[0].stage='S4-G3',
    t=>t[0].changes[0].path='../escape',
  ]){
    const catalog=structuredClone(tasks);mutation(catalog);
    assert.equal(choose(make({admittedCatalog:catalog})).kind,'STOPPED');
  }
});
test('missing journal never creates fresh readiness or resets a retry',()=>{
  assert.equal(choose(make({journal:null})).kind,'UNKNOWN');
  const state=journal();delete state.lanes.engine;
  assert.equal(choose(make({journal:state})).reason,'DURABLE_LANE_IDENTITY_OR_STATE_INVALID');
  state.lanes['ru-auth'].retries=2;
  assert.equal(choose(make({journal:state})).reason,'DURABLE_LANE_IDENTITY_OR_STATE_INVALID');
});

test('advisory planning never mutates any catalog, journal, or lane input',()=>{
  const state=journal(),catalog=structuredClone(tasks),defs=structuredClone(lanes);
  const before=JSON.stringify({state,catalog,defs});
  choose(make({laneDefinitions:defs,admittedCatalog:catalog,journal:state}));
  assert.equal(JSON.stringify({state,catalog,defs}),before);
});

test('exact owner workstream branch identity cannot be substituted by caller',()=>{
  for(const mutation of [
    defs=>defs[0].branch='asi/unreviewed-engine-work',
    defs=>{const old=defs[0].branch;defs[0].branch=defs[1].branch;defs[1].branch=old;},
    defs=>defs[3].repository='malicious/other',
  ]){
    const defs=structuredClone(lanes);mutation(defs);
    assert.equal(choose(make({laneDefinitions:defs})).reason,'STATIC_LANE_DEFINITIONS_INVALID');
  }
});
test('unknown or missing durable state cannot release another lane after crash',()=>{
  for(const mutation of [
    state=>{state.lanes['p0-trust'].mode='UNKNOWN';},
    state=>{delete state.lanes['p0-trust'];},
    state=>{state.lanes['p0-trust'].mode='READY';state.lanes['p0-trust'].retries=1;},
    state=>{state.lanes['p0-trust'].mode='BACKOFF';state.lanes['p0-trust'].retries=1;state.lanes['p0-trust'].nextEligibleAtMs=100;},
  ]){
    const state=journal();mutation(state);
    const result=choose(make({journal:state}));
    assert.equal(result.kind,'STOPPED');
    assert.equal(result.candidate,null);
    assert.equal(result.authority,'NONE_SOURCE_ONLY');
  }
});


test('catalog withdrawal cannot erase historical UNKNOWN or FAILED_LOCKED records',()=>{
  const catalog=structuredClone(tasks.slice(0,4));
  const state=journal();
  state.lanes['p0-atomic-budget'].mode='FAILED_LOCKED';
  assert.equal(choose(make({admittedCatalog:catalog,journal:state})).reason,
    'HISTORICAL_LANE_LOCK_REQUIRES_RECONCILIATION');
  state.lanes['p0-atomic-budget'].mode='UNKNOWN';
  assert.equal(choose(make({admittedCatalog:catalog,journal:state})).reason,
    'HISTORICAL_LANE_LOCK_REQUIRES_RECONCILIATION');
  state.lanes['p0-atomic-budget'].mode='DONE';
  assert.equal(choose(make({admittedCatalog:catalog,journal:state})).kind,'CANDIDATE');
  delete state.lanes['p0-atomic-budget'];
  assert.equal(choose(make({admittedCatalog:catalog,journal:state})).reason,
    'UNADMITTED_LANE_JOURNAL_INVALID');
  state.lanes['unexpected-sixth-lane']={...state.lanes.engine};
  assert.equal(choose(make({admittedCatalog:catalog,journal:state})).reason,
    'UNRECOGNIZED_DURABLE_LANE');
  state.lanes['p0-atomic-budget']=null;
  delete state.lanes['unexpected-sixth-lane'];
  assert.equal(choose(make({admittedCatalog:catalog,journal:state})).reason,
    'UNADMITTED_LANE_JOURNAL_INVALID');
});

test('a sixth admitted task cannot be silently ignored beside a named owner lane',()=>{
  const rogue={...tasks[0],id:'extra-sixth',branch:'asi/rogue-extra',
    changes:[{path:'docs/engine-lanes/extraneous.txt'}]};
  const result=choose(make({admittedCatalog:[tasks[0],rogue]}));
  assert.equal(result.kind,'STOPPED');
  assert.equal(result.reason,'MIXED_OR_UNRECOGNIZED_ADMITTED_SCOPE');
  assert.equal(result.candidate,null);
  assert.equal(choose(make({admittedCatalog:[tasks[0],{...rogue,repo:'another/repository'}]})).kind,'STOPPED');
  assert.equal(choose(make({admittedCatalog:[rogue]})).kind,'NONE');
});

test('withdrawn lane cannot hide corrupt clock, retry, or pinned identity in its journal',()=>{
  const catalog=structuredClone(tasks.slice(0,4));
  for(const mutate of [
    s=>{delete s.taskSha;},
    s=>{s.taskId='';},
    s=>{s.taskSha='f';},
    s=>{s.lastServedAtMs=NOW+1;},
    s=>{s.nextEligibleAtMs=-1;},
    s=>{s.retries=99;},
    s=>{s.mode='READY';s.retries=1;},
    s=>{s.mode='BACKOFF';s.retries=1;s.nextEligibleAtMs=0;},
    s=>{s.mode='READY';s.taskId=null;s.taskSha=null;},
  ]){
    const state=journal();mutate(state.lanes['p0-atomic-budget']);
    const result=choose(make({admittedCatalog:catalog,journal:state}));
    assert.equal(result.kind,'STOPPED');
    assert.equal(result.reason,'UNADMITTED_LANE_JOURNAL_INVALID');
  }
  const state=journal();
  state.lanes['p0-atomic-budget']={mode:'BLOCKED',taskId:null,taskSha:null,
    lastServedAtMs:0,nextEligibleAtMs:0,retries:0};
  const result=choose(make({admittedCatalog:catalog,journal:state}));
  assert.equal(result.kind,'CANDIDATE');
  assert.equal(result.candidate.laneId,'engine');
});

test('withdrawn never-admitted BLOCKED identity cannot erase prior durable work counters',()=>{
  const catalog=structuredClone(tasks.slice(0,4));
  for(const [field,value] of [['lastServedAtMs',1],['nextEligibleAtMs',1],['retries',1]]){
    const state=journal();
    state.lanes['p0-atomic-budget']={mode:'BLOCKED',taskId:null,taskSha:null,
      lastServedAtMs:0,nextEligibleAtMs:0,retries:0,[field]:value};
    const result=choose(make({admittedCatalog:catalog,journal:state}));
    assert.equal(result.kind,'STOPPED',field);
    assert.equal(result.reason,'UNADMITTED_LANE_JOURNAL_INVALID',field);
    assert.equal(result.authority,'NONE_SOURCE_ONLY');
  }
});

test('inherited journal map and prototype-backed state cannot fabricate readiness',()=>{
  for(const mutation of [
    state=>{state.lanes=Object.create(state.lanes);},
    state=>{state.lanes.engine=Object.create(state.lanes.engine);},
    state=>{const old=state.lanes.engine;state.lanes.engine={...old};delete state.lanes.engine.mode;Object.setPrototypeOf(state.lanes.engine,old);},
  ]){
    const state=journal();mutation(state);
    const result=choose(make({journal:state}));
    assert.notEqual(result.kind,'CANDIDATE');
    assert.equal(result.candidate,null);
    assert.equal(result.authority,'NONE_SOURCE_ONLY');
  }
});
test('inherited catalog/scope, accessor traps and hostile proxies fail closed',()=>{
  const checks=[
    ()=>{const d=structuredClone(lanes);d[0]=Object.create(d[0]);return make({laneDefinitions:d});},
    ()=>{const c=structuredClone(tasks);c[0]=Object.create(c[0]);return make({admittedCatalog:c});},
    ()=>{const c=structuredClone(tasks);c[0].changes[0]=Object.create(c[0].changes[0]);return make({admittedCatalog:c});},
    ()=>{const c=structuredClone(tasks);Object.defineProperty(c[0].changes[0],'path',{get(){throw Error('hostile getter');}});return make({admittedCatalog:c});},
    ()=>new Proxy(make(),{get(){throw Error('hostile snapshot');}}),
  ];
  for(const makeAttack of checks){
    const result=choose(makeAttack());
    assert.notEqual(result.kind,'CANDIDATE');
    assert.equal(result.candidate,null);
    assert.equal(result.authority,'NONE_SOURCE_ONLY');
  }
});

test('mutating Array.some/map cannot rewrite the fixed five-lane branch contract',()=>{
  const definitions=structuredClone(lanes), catalog=structuredClone(tasks);
  definitions[0].branch='asi/evil-branch';
  catalog[0].branch='asi/evil-branch';
  definitions.some=()=>false;
  definitions.map=()=>names.map(([id])=>id);
  const result=choose(make({laneDefinitions:definitions,admittedCatalog:catalog}));
  assert.equal(result.kind,'UNKNOWN');
  assert.equal(result.reason,'STATIC_LANE_DEFINITIONS_INVALID');
  assert.equal(result.candidate,null);
});
test('admitted catalog and path arrays cannot use method overrides, holes or getters',()=>{
  const checks=[
    ()=>{const c=structuredClone(tasks);c.filter=()=>[];return c;},
    ()=>{const c=structuredClone(tasks);delete c[1];return c;},
    ()=>{const c=structuredClone(tasks);c[0].changes.some=()=>false;return c;},
    ()=>{const c=structuredClone(tasks);c[0].changes[Symbol.iterator]=function*(){};return c;},
    ()=>{const c=structuredClone(tasks);Object.defineProperty(c,0,{get(){throw Error('trapped catalog');}});return c;},
  ];
  for(const attack of checks){
    const result=choose(make({admittedCatalog:attack()}));
    assert.notEqual(result.kind,'CANDIDATE');
    assert.equal(result.candidate,null);
    assert.equal(result.authority,'NONE_SOURCE_ONLY');
  }
});


test('non-enumerable and Symbol journal keys cannot conceal withdrawn failed lanes',()=>{
  for(const key of ['hidden-sixth-lane',Symbol('hidden-sixth-lane')]){
    const state=journal();
    Object.defineProperty(state.lanes,key,{value:{mode:'FAILED_LOCKED'},enumerable:false});
    const result=choose(make({journal:state}));
    assert.equal(result.kind,'STOPPED');
    assert.equal(result.reason,'UNRECOGNIZED_DURABLE_LANE');
    assert.equal(result.candidate,null);
  }
});
test('inherited Object.prototype lane state cannot replace missing owned durable evidence',()=>{
  const state=journal();delete state.lanes.engine;
  const original=Object.getOwnPropertyDescriptor(Object.prototype,'engine');
  Object.defineProperty(Object.prototype,'engine',{configurable:true,value:{
    mode:'READY',taskId:tasks[0].id,taskSha:tasks[0].sha,
    lastServedAtMs:0,nextEligibleAtMs:0,retries:0
  }});
  try {
    const result=choose(make({journal:state}));
    assert.equal(result.kind,'STOPPED');
    assert.equal(result.reason,'DURABLE_LANE_IDENTITY_OR_STATE_INVALID');
    assert.equal(result.candidate,null);
  } finally {
    if(original) Object.defineProperty(Object.prototype,'engine',original);
    else delete Object.prototype.engine;
  }
});
