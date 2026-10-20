import test from 'node:test';
import assert from 'node:assert/strict';
import {calculate,readChecks} from '../roadmap-next-action.mjs';
const sha='f'.repeat(40);
const contract={releaseId:'STRIGUNOV4-READY-FOR-DEMO',stages:
  Array.from({length:6},(_,i)=>({id:'S4-G'+(i+1),status:i===0?'IN_PROGRESS':'NOT_STARTED'}))};
const checks=['validate','channel-manager-recovery-postgres'].map((name,i)=>({
  id:i+1,name,head_sha:sha,status:'completed',conclusion:'success',app:{slug:'github-actions'}
}));
const base={contract,pr:{number:510,state:'open',merged:false,head_sha:sha},
  checks,checksComplete:true,threads:[{isResolved:false},{isResolved:false},{isResolved:false},{isResolved:false}]};
test('no trusted contract fails closed',()=>{
  const r=calculate({...base,contract:null});
  assert.equal(r.length,6);assert.ok(r.every(x=>x.gate==='BLOCKED'));
});
test('unresolved review comments block merge despite green CI',()=>{
  const r=calculate(base);
  assert.equal(r[0].gate,'PREPARATION_ONLY');
  assert.match(r[0].next,/4 незакрытых/);
  assert.ok(r.slice(1).every(x=>x.gate==='BLOCKED'));
});
test('stale checks do not imply permission',()=>{
  const stale=checks.map(x=>({...x,head_sha:'a'.repeat(40)}));
  const r=calculate({...base,checks:stale,threads:[]});
  assert.equal(r[0].gate,'PREPARATION_ONLY');
  assert.match(r[0].next,/CI/);
});
test('green checks and no comments still require owner approval',()=>{
  const r=calculate({...base,threads:[]});
  assert.equal(r[0].gate,'OWNER_APPROVAL');
  assert.match(r[0].next,/отдельное решение владельца/);
});
test('merge does not imply required trusted main check',()=>{
  const r=calculate({...base,pr:{...base.pr,merged:true}});
  assert.equal(r[0].gate,'OWNER_APPROVAL');
  assert.match(r[0].next,/release_governance/);
});
test('ACCEPTED without independent physical SHA proof cannot advance',()=>{
  const c=structuredClone(contract);
  c.stages[0].status='ACCEPTED';c.stages[1].status='IN_PROGRESS';
  const r=calculate({...base,contract:c});
  assert.ok(r.every(x=>x.gate==='BLOCKED'));
});
test('unknown PR or reviews fail closed',()=>{
  assert.ok(calculate({...base,pr:null}).every(x=>x.gate==='BLOCKED'));
  assert.equal(calculate({...base,threads:null})[0].gate,'BLOCKED');
});
test('invalid stage ordering stops the plan',()=>{
  const c=structuredClone(contract);c.stages[2].id='S4-G8';
  assert.ok(calculate({...base,contract:c}).every(x=>x.gate==='BLOCKED'));
});
test('older success never overrides newest failure or pending attempt',()=>{
  for(const status of ['completed','in_progress','queued']) {
    const newest={...checks[0],id:3,status,conclusion:status==='completed'?'failure':null};
    for(const results of [[...checks,newest],[newest,...checks]]) {
      assert.equal(calculate({...base,checks:results,threads:[]})[0].gate,'PREPARATION_ONLY');
    }
  }
});
test('newest successful attempt supersedes a failure, not another SHA or app',()=>{
  const failed={...checks[0],id:3,conclusion:'failure'};
  const current={...checks[0],id:4};
  assert.equal(calculate({...base,checks:[...checks,failed,current],threads:[]})[0].gate,'OWNER_APPROVAL');
  for(const replacement of [{...current,head_sha:'a'.repeat(40)},
    {...current,app:{slug:'another-app'}},{...current,id:null}]) {
    assert.equal(calculate({...base,checks:[...checks,failed,replacement],threads:[]})[0].gate,'PREPARATION_ONLY');
  }
});
test('unproven pagination completeness fails closed',()=>{
  for(const checksComplete of [false,undefined])
    assert.equal(calculate({...base,checksComplete,threads:[]})[0].gate,'BLOCKED');
});
test('later-page failing rerun is retrieved and prevents owner-approval projection',async()=>{
  const filler=Array.from({length:98},(_,i)=>({...checks[0],name:'other',id:i+3}));
  const pages=[[...checks,...filler],[{...checks[0],id:101,conclusion:'failure'}]];
  const calls=[];
  const results=await readChecks(sha,'fixture',async url=>{
    const query=new URL(url).searchParams;
    assert.equal(query.get('filter'),'all');assert.equal(query.get('per_page'),'100');
    const page=Number(query.get('page'));calls.push(page);
    return {total_count:101,check_runs:pages[page-1]};
  });
  assert.deepEqual(calls,[1,2]);assert.equal(results.length,101);
  assert.equal(calculate({...base,checks:results,threads:[]})[0].gate,'PREPARATION_ONLY');
});
test('short, missing, malformed and excessive check pages reject',async()=>{
  for(const data of [
    {total_count:3,check_runs:checks}, {check_runs:checks},
    {total_count:'2',check_runs:checks}, {total_count:1001,check_runs:checks},
    {total_count:2,check_runs:[checks[0],checks[0]]},
    {total_count:2,check_runs:[checks[0],{...checks[1],head_sha:'a'.repeat(40)}]},
  ]) await assert.rejects(readChecks(sha,'fixture',async()=>data),/INCOMPLETE_CHECK_RUNS/);
  await assert.rejects(readChecks(sha,'fixture',async()=>{throw new Error('API_FAILED');}),/API_FAILED/);
});
test('changed totals and duplicate IDs across pages reject partial snapshots',async()=>{
  const first=Array.from({length:100},(_,i)=>({...checks[0],id:i+1}));
  for(const second of [{total_count:102,check_runs:[{...checks[0],id:101}]},
    {total_count:101,check_runs:[first[0]]}, {total_count:101,check_runs:[]}]) {
    let page=0;
    await assert.rejects(readChecks(sha,'fixture',async()=>++page===1
      ? {total_count:101,check_runs:first}:second),/INCOMPLETE_CHECK_RUNS/);
  }
});
