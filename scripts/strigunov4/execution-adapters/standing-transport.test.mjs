import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublisherTransport} from './publisher-transport.mjs';
import {digest} from './state.mjs';

const sha='a'.repeat(40),branch='asi/engine-task/offline';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
function fakeFetch(t){
  const calls=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,options});return new Response('{}',{status:200});});
  return calls;
}

test('every bounded Publisher method passes immutable exact wire identity to host guard',async t=>{
  const calls=fakeFetch(t),seen=[];
  const port=createPublisherTransport({token:'fixture',beforeRequest:async d=>{assert(Object.isFrozen(d));seen.push(d);return true;}});
  await port.get('branches/main');
  await port.createTree(sha,[{path:'scripts/example.mjs',mode:'100644',type:'blob',content:'fixture'}]);
  await port.createCommit(sha,sha,'offline');
  await port.createBranch(branch,sha);
  await port.createDraft(branch,'offline',{baseSha:sha,head:sha,deltaSha256:'b'.repeat(64)});
  assert.equal(calls.length,5);assert.equal(seen.length,5);
  for(let i=0;i<calls.length;i++){
    const {options,url}=calls[i],d=seen[i];
    assert.equal(d.method,options.method);assert(url.endsWith('/'+d.route));
    assert.equal(d.payloadSha256,digest(options.body??''));
    assert.equal(d.requestSha256,digest(JSON.stringify({method:d.method,route:d.route,payloadSha256:d.payloadSha256})));
  }
});

test('caller mutation while token is pending cannot change reserved or sent bytes',async t=>{
  const calls=fakeFetch(t),token=deferred(),entered=deferred();let descriptor;
  const port=createPublisherTransport({token:()=>{entered.resolve();return token.promise;},beforeRequest:async d=>{descriptor=d;return true;}});
  const entries=[{path:'scripts/example.mjs',mode:'100644',type:'blob',content:'original'}];
  const request=port.createTree(sha,entries);await entered.promise;entries[0].content='changed';entries.push({...entries[0]});token.resolve('fixture');await request;
  const sent=JSON.parse(calls[0].options.body);assert.equal(sent.tree.length,1);assert.equal(sent.tree[0].content,'original');assert.equal(descriptor.payloadSha256,digest(calls[0].options.body));
});

test('false, missing and proposal results deny and permanently poison without fetch',async t=>{
  const calls=fakeFetch(t);
  for(const result of [false,undefined,{status:'PROPOSAL_ELIGIBLE',authorized:false},{reserved:true}]){
    const port=createPublisherTransport({token:'fixture',beforeRequest:async()=>result});
    await assert.rejects(port.get('branches/main'),/REMOTE_RESULT_UNKNOWN/);
    await assert.rejects(port.get('branches/main'),/TRANSPORT_LOCKED/);
  }
  assert.equal(calls.length,0);
});

test('guard exception denies and poisons before any remote request',async t=>{
  const calls=fakeFetch(t);const port=createPublisherTransport({token:'fixture',beforeRequest:async()=>{throw Error('fixture');}});
  await assert.rejects(port.get('branches/main'),/REMOTE_RESULT_UNKNOWN/);
  await assert.rejects(port.get('branches/main'),/TRANSPORT_LOCKED/);assert.equal(calls.length,0);
});

test('late token completion after timeout cannot call guard or fetch',async t=>{
  const calls=fakeFetch(t),token=deferred();let guarded=0;
  const port=createPublisherTransport({token:()=>token.promise,timeoutMs:10,beforeRequest:async()=>{guarded++;return true;}});
  await assert.rejects(port.get('branches/main'),/REMOTE_RESULT_UNKNOWN/);
  token.resolve('fixture');await tick();assert.equal(guarded,0);assert.equal(calls.length,0);
  await assert.rejects(port.get('branches/main'),/TRANSPORT_LOCKED/);
});

test('late guard completion after timeout cannot initiate fetch',async t=>{
  const calls=fakeFetch(t),guard=deferred(),entered=deferred();let signal;
  const port=createPublisherTransport({token:'fixture',timeoutMs:10,beforeRequest:async d=>{signal=d.signal;entered.resolve();return guard.promise;}});
  const request=port.get('branches/main');await entered.promise;await assert.rejects(request,/REMOTE_RESULT_UNKNOWN/);
  assert.equal(signal.aborted,true);guard.resolve(true);await tick();assert.equal(calls.length,0);
  await assert.rejects(port.get('branches/main'),/TRANSPORT_LOCKED/);
});

test('omitted guard retains ordinary bounded transport behavior',async t=>{
  const calls=fakeFetch(t);const port=createPublisherTransport({token:'fixture'});
  assert.deepEqual(await port.get('branches/main'),{});assert.equal(calls.length,1);
});
