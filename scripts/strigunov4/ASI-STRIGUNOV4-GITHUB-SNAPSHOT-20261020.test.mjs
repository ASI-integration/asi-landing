import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchVerifiedSnapshot,lastCheck,independentCodeRabbit} from './ASI-STRIGUNOV4-GITHUB-SNAPSHOT-20261020.mjs';
const sha='a'.repeat(40),head='b'.repeat(40);
const contract={schemaVersion:'asi.demo-release.v1',releaseId:'STRIGUNOV4-READY-FOR-DEMO',state:'FROZEN_ON_OWNER_MERGE',stages:[]};
function mock(){return async route=>{
 if(route==='branches/main')return {protected:true,commit:{sha}};
 if(route.startsWith('contents/'))return {type:'file',encoding:'base64',content:Buffer.from(JSON.stringify(contract)).toString('base64')};
 if(route.startsWith('issues/')&&route.includes('comments'))return [{user:{login:'coderabbitai[bot]'},body:head+' No actionable comments were generated in the recent review',created_at:'2026-10-20T12:00:00Z'}];
 if(route.startsWith('issues/'))return {number:Number(route.split('/').at(-1)),state:'open',labels:[]};
 if(route.startsWith('pulls/'))return {number:Number(route.split('/').at(-1)),head:{sha:head,repo:{full_name:'ASI-integration/asi-landing'}},state:'open',merged:false};
 if(route.startsWith('commits/'))return {total_count:2,check_runs:['validate','release_governance'].map(name=>({name,head_sha:head,status:'completed',conclusion:'success',completed_at:'2026-10-20T15:00:00Z'}))};
 throw Error('unexpected route '+route);
};}
const projects=async()=>({items:[1,2,3,4,5,6].map(n=>({issue:510+n,stage:'S4-G'+n,gate:n===1?'PREPARATION_ONLY':'BLOCKED'}))});
test('01 snapshot preserves SHA and authorized Projects gate',async()=>{
 const s=await fetchVerifiedSnapshot({api:mock(),readProjects:projects});assert.equal(s.mainSha,sha);assert.equal(s.prs[509].head,head);assert.equal(s.project[511],'PREPARATION_ONLY');
});
test('02 newer failed required check cannot be replaced with stale success',()=>{
 const checks=[{name:'validate',head_sha:head,status:'completed',conclusion:'success',completed_at:'2026-10-20T10:00:00Z'},{name:'validate',head_sha:head,status:'completed',conclusion:'failure',completed_at:'2026-10-20T11:00:00Z'}];assert.equal(lastCheck(checks,head,'validate'),'unknown');
});
test('03 cross-head clean review is not accepted',()=>{
 const list=[{user:{login:'coderabbitai[bot]'},body:sha+' No actionable comments were generated in the recent review',created_at:'2026-10-20T11:00:00Z'}];assert.equal(independentCodeRabbit(list,head).completed,false);
});
test('04 moving main invalidates snapshot',async()=>{
 let c=0;const api=async name=>{if(name==='branches/main'){c++;if(c===2)return {protected:true,commit:{sha:'c'.repeat(40)}};}return mock()(name);};await assert.rejects(fetchVerifiedSnapshot({api,readProjects:projects}),/MAIN_MOVED/);
});
test('05 unavailable projects fail closed',async()=>{
 await assert.rejects(fetchVerifiedSnapshot({api:mock(),readProjects:async()=>({items:[]})}),/PROJECT_GATES_UNVERIFIED/);
});

test('06 closed historical issue is readable but cannot authorize execution',async()=>{
 const api=async route=>{if(route==='issues/511')return {number:511,state:'closed',labels:[]};return mock()(route);};
 const s=await fetchVerifiedSnapshot({api,readProjects:projects});
 assert.equal(s.issues[511].state,'closed');
});
