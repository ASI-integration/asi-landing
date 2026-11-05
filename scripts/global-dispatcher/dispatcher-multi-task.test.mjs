import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createGlobalDispatcher,initializeRoutingState} from './dispatcher.mjs';

const BASE='a'.repeat(40);
const make=()=>({
  id:'cabins',
  contractHash:'b'.repeat(64),
  contract:{execution:'disabled',maxAttemptsPerTask:1,maxPlansPerStage:5},
  evaluate:()=>({
    status:'READY',nextAction:'Source proposal only',stage:'S4-G2',
    head:BASE,repository:'ASI-integration/asi-landing',
    acceptedStages:[],terminal:[],
    candidates:['task-one','task-two','task-three'].map((id,i)=>({
      id,operation:'prepare-source',tool:'existing-runner-bridge',
      priority:3-i,paths:['src/asi-universal/example.mjs']
    }))
  })
});

test('three independent tasks of one product remain selectable, without replay',
  {skip:process.platform!=='linux'},async()=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'asi-routing-multi-'));
    await fs.chmod(dir,0o700);
    try{
      await initializeRoutingState(dir);
      const d=createGlobalDispatcher({stateDir:dir,adapters:[make()]});
      const picked=[];
      for(let i=0;i<3;i++){
        const r=await d.plan({cabins:{}});
        assert.equal(r.status,'READY');
        assert.equal(r.selected.product,'cabins');
        picked.push(r.selected.task.id);
      }
      assert.deepEqual(picked,['task-one','task-two','task-three']);
      const repeated=await d.plan({cabins:{}});
      assert.equal(repeated.selected,null);
      assert.equal(repeated.status,'WAITING');
      const reboot=createGlobalDispatcher({stateDir:dir,adapters:[make()]});
      const after=await reboot.plan({cabins:{}});
      assert.equal(after.selected,null);
      const snapshot=JSON.parse(await fs.readFile(path.join(dir,'routing.json'),'utf8'));
      assert.equal(snapshot.state.tick,3);
      assert.deepEqual(snapshot.state.products[0].planned.map(t=>t.id),picked);
    }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('a per-product plan limit is still enforced after multi-task fix',
  {skip:process.platform!=='linux'},async()=>{
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'asi-routing-max-'));
    await fs.chmod(dir,0o700);
    try{
      await initializeRoutingState(dir);
      const a=make();a.contract.maxPlansPerStage=2;
      const d=createGlobalDispatcher({stateDir:dir,adapters:[a]});
      assert.equal((await d.plan({cabins:{}})).status,'READY');
      assert.equal((await d.plan({cabins:{}})).status,'READY');
      const third=await d.plan({cabins:{}});
      assert.equal(third.selected,null);
      assert.equal(third.status,'BLOCKED');
    }finally{await fs.rm(dir,{recursive:true,force:true});}
});
