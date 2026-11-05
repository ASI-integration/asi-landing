import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createProductAdapter,decomposeProductGoal} from './product-adapters.mjs';
import {createGlobalDispatcher,initializeRoutingState} from './dispatcher.mjs';
import {planFiveWorkerWave} from './five-worker-wave.mjs';

test('five independent tasks for one arbitrary product use the existing durable routing journal',async t=>{
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'asi-five-wave-'));
  t.after(()=>fs.rm(base,{recursive:true,force:true}));
  const stateDir=path.join(base,'routing');
  await fs.mkdir(stateDir,{mode:0o700});
  await initializeRoutingState(stateDir);

  const names=['cabin-structure','guest-comms','pricing','availability','marketing'];
  const criteria=names.map(n=>'criterion-'+n);
  const paths=names.map(n=>'scripts/'+n+'.mjs');
  const contract={
    schema:'asi.product-route.v1',id:'asi-cabins',repository:'ASI-integration/asi-landing',
    execution:'disabled',
    goal:{result:'Prepare five independent product improvements',criteria},
    evidence:['tests','review','pr','ci','report'],
    stages:[{id:'source',criteria,dependsOn:[]}],
    functions:['prepare-source'],tools:['existing-runner-bridge'],
    paths,maxAttemptsPerTask:1,maxPlansPerStage:5
  };
  const workOrders=names.map((name,i)=>({
    id:name,stage:'source',operation:'prepare-source',tool:'existing-runner-bridge',
    paths:[paths[i]],covers:[criteria[i]],dependsOn:[],priority:50-i,
    requiredAuthority:['isolated-source-fixture'],
    cost:{requests:0,mutations:0,computeMs:100,paidMicrousd:0}
  }));
  const goal={
    id:'five-source-tasks',product:contract.id,repository:contract.repository,
    head:'e'.repeat(40),criteria,priority:50,
    notBefore:100,expiresAt:100000,
    budget:{maxTasks:5,maxRequests:0,maxMutations:0,maxComputeMs:500,maxPaidMicrousd:0}
  };
  const adapter=createProductAdapter(contract,{workOrders,maxConcurrentPlans:5,
    clock:()=>1000,verifyEvidence:()=>false});
  const graph=decomposeProductGoal(contract,goal,workOrders,{now:1000});
  assert.equal(graph.nodes.length,5);
  const snapshot={product:contract.id,contractHash:adapter.contractHash,
    head:goal.head,goal,stages:[{id:'source',status:'OPEN'}],
    tasks:graph.nodes.map(n=>({...structuredClone(n),status:'READY'}))};
  const dispatcher=createGlobalDispatcher({stateDir,adapters:[adapter]});
  const result=await planFiveWorkerWave({dispatcher,snapshots:{'asi-cabins':snapshot}});
  assert.equal(result.status,'PLANNED');
  assert.equal(result.slots.length,5);
  assert.equal(new Set(result.slots.map(s=>s.task.id)).size,5);
  assert(result.slots.every(s=>s.authority===null&&s.executable===false));
  assert.equal(result.publisherConcurrency,1);
  const record=JSON.parse(await fs.readFile(path.join(stateDir,'routing.json'),'utf8'));
  assert.equal(record.state.tick,5);
  assert.equal(record.state.products.length,1);
  assert.equal(record.state.products[0].planned.length,5);

  const restart=createGlobalDispatcher({stateDir,adapters:[adapter]});
  const afterRestart=await planFiveWorkerWave({dispatcher:restart,snapshots:{'asi-cabins':snapshot}});
  assert.equal(afterRestart.status,'IDLE');
  assert.equal(afterRestart.slots.length,0);
  const preserved=JSON.parse(await fs.readFile(path.join(stateDir,'routing.json'),'utf8'));
  assert.equal(preserved.state.products[0].planned.length,5);
});
