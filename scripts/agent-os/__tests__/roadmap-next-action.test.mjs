import test from 'node:test';
import assert from 'node:assert/strict';
import {calculate} from '../roadmap-next-action.mjs';
const sha='f'.repeat(40);
const contract={releaseId:'STRIGUNOV4-READY-FOR-DEMO',stages:
  Array.from({length:6},(_,i)=>({id:'S4-G'+(i+1),status:i===0?'IN_PROGRESS':'NOT_STARTED'}))};
const checks=['validate','channel-manager-recovery-postgres'].map(name=>({
  name,head_sha:sha,status:'completed',conclusion:'success',app:{slug:'github-actions'}
}));
const base={contract,pr:{number:510,state:'open',merged:false,head_sha:sha},
  checks,threads:[{isResolved:false},{isResolved:false},{isResolved:false},{isResolved:false}]};
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
