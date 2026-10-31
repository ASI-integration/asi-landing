import test from 'node:test';
import assert from 'node:assert/strict';
import {createGitHubReader,isCompiledGitHubRead} from './github-readonly.mjs';
import {digest} from './state.mjs';
const sha='a'.repeat(40);
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
const reply=data=>new Response(JSON.stringify(data),{status:200});
function fakeFetch(t){const calls=[];t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,options});return reply({});});return calls;}

test('all REST pages and fixed GraphQL query pages are guarded with exact immutable wire identity',async t=>{
 const seen=[],calls=[];
 const reader=createGitHubReader({token:'fixture',requestAdmission:async d=>{assert(Object.isFrozen(d));assert.equal('token' in d,false);seen.push(d);return true;}});
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  const d=seen[calls.length];assert(d,'reservation must precede fetch');calls.push({url,options});
  assert.equal(d.method,options.method);assert.equal(d.payloadSha256,digest(options.body??''));
  assert.equal(d.requestSha256,digest(JSON.stringify({method:d.method,route:d.route,payloadSha256:d.payloadSha256})));
  if(url.includes('/graphql')){assert.equal(isCompiledGitHubRead(d),true);assert.equal(isCompiledGitHubRead({...d}),false);assert.equal(d.route,'graphql');const b=JSON.parse(options.body);assert(b.query.startsWith('query('));
   return reply({data:{repository:{pullRequest:{headRefOid:sha,reviewThreads:{nodes:[],pageInfo:{hasNextPage:!b.variables.cursor,endCursor:'page-two'}}}}}});}
  assert.equal(isCompiledGitHubRead(d),false);assert(url.endsWith('/'+d.route));
  if(new URL(url).searchParams.get('page')==='1')return reply(Array.from({length:100},(_,i)=>({id:i+1})));
  if(new URL(url).searchParams.get('page')==='2')return reply([{id:101}]);return reply({});
 });
 await reader.get('branches/main');assert.equal((await reader.pages('pulls/123/reviews')).length,101);
 assert.deepEqual(await reader.threads({pr:123,sha}),[]);assert.equal(calls.length,5);assert.equal(seen.length,5);
 assert.equal(isCompiledGitHubRead(Object.freeze({method:'POST',route:'graphql',payloadSha256:digest('query{}')})),false);
 assert.equal(isCompiledGitHubRead(null),false);
});

test('GraphQL variables are captured before asynchronous credential lookup',async t=>{
 const token=deferred(),entered=deferred(),calls=[];let descriptor;
 t.mock.method(globalThis,'fetch',async(url,options)=>{calls.push({url,options});return reply({data:{repository:{pullRequest:{headRefOid:sha,reviewThreads:{nodes:[],pageInfo:{hasNextPage:false}}}}}});});
 const reader=createGitHubReader({token:()=>{entered.resolve();return token.promise;},requestAdmission:async d=>{descriptor=d;return true;}});
 const task={pr:123,sha},pending=reader.threads(task);await entered.promise;task.pr=999;token.resolve('fixture');await pending;
 assert.equal(JSON.parse(calls[0].options.body).variables.number,123);assert.equal(descriptor.payloadSha256,digest(calls[0].options.body));
});

test('false, absent and non-authorizing results deny before fetch and poison reader',async t=>{
 const calls=fakeFetch(t);
 for(const result of [false,undefined,{status:'PROPOSAL_ELIGIBLE',authorized:false},{reserved:true}]){
  const reader=createGitHubReader({token:'fixture',requestAdmission:async()=>result});
  await assert.rejects(reader.get('branches/main'),/HOST_REQUEST_GUARD_DENIED/);
  await assert.rejects(reader.get('branches/main'),/GITHUB_READER_LOCKED/);
 }assert.equal(calls.length,0);
});

test('guard error leaves reader poisoned with no remote call',async t=>{
 const calls=fakeFetch(t),reader=createGitHubReader({token:'fixture',requestAdmission:async()=>{throw Error('fixture denial');}});
 await assert.rejects(reader.get('branches/main'),/fixture denial/);await assert.rejects(reader.get('branches/main'),/GITHUB_READER_LOCKED/);assert.equal(calls.length,0);
});

test('late credential after deadline cannot call guard or fetch',async t=>{
 const calls=fakeFetch(t),token=deferred();let guarded=0;
 const reader=createGitHubReader({token:()=>token.promise,timeoutMs:10,requestAdmission:async()=>{guarded++;return true;}});
 await assert.rejects(reader.get('branches/main'),/PORT_TIMEOUT/);token.resolve('fixture');await tick();
 assert.equal(guarded,0);assert.equal(calls.length,0);await assert.rejects(reader.get('branches/main'),/GITHUB_READER_LOCKED/);
});

test('late guard after deadline cannot dispatch even if it ignores abort',async t=>{
 const calls=fakeFetch(t),guard=deferred(),entered=deferred();let signal;
 const reader=createGitHubReader({token:'fixture',timeoutMs:10,requestAdmission:async d=>{signal=d.signal;entered.resolve();return guard.promise;}});
 const pending=reader.get('branches/main');await entered.promise;await assert.rejects(pending,/PORT_TIMEOUT/);
 assert.equal(signal.aborted,true);guard.resolve(true);await tick();assert.equal(calls.length,0);await assert.rejects(reader.get('branches/main'),/GITHUB_READER_LOCKED/);
});

test('response body stalls are included in request deadline and are never retried',async t=>{
 let calls=0,finish;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(new ReadableStream({start(controller){finish=()=>controller.close();}}));});
 const reader=createGitHubReader({token:'fixture',timeoutMs:10,requestAdmission:async()=>true});
 await assert.rejects(reader.get('branches/main'),/PORT_TIMEOUT/);finish();await tick();
 await assert.rejects(reader.get('branches/main'),/GITHUB_READER_LOCKED/);assert.equal(calls,1);
});

test('omitted guard retains ordinary reads while encoded traversal and URL normalization are denied',async t=>{
 const calls=fakeFetch(t),reader=createGitHubReader({token:'fixture'});
 for(const route of ['pulls/%2e%2e/%2e%2e/%2e%2e/other/repo/issues','pulls/%2Fother','pulls/123\n'])
  await assert.rejects(reader.get(route),/ENDPOINT_NOT_ALLOWED/);
 assert.equal(calls.length,0);
 assert.deepEqual(await reader.get('branches/main'),{});
 assert.deepEqual(await reader.get('pulls?head=ASI-integration:asi%2Ffixture'),{});assert.equal(calls.length,2);
});
