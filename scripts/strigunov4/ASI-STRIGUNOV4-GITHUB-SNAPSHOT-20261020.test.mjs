import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchVerifiedSnapshot,lastCheck,independentCodeRabbit} from './ASI-STRIGUNOV4-GITHUB-SNAPSHOT-20261020.mjs';
const sha='a'.repeat(40),head='b'.repeat(40);
const recent=(sha)=>'<!-- recent_review_start -->\n'+
 'No actionable comments were generated in the recent review. 🎉\n'+
 'Reviewing files that changed from the base of the PR and between '+('c'.repeat(40))+' and '+sha+'.\n'+
 '<!-- recent_review_end -->';
const contract={schemaVersion:'asi.demo-release.v1',releaseId:'STRIGUNOV4-READY-FOR-DEMO',state:'FROZEN_ON_OWNER_MERGE',stages:[]};
function mock(){return async route=>{
 if(route==='branches/main')return {protected:true,commit:{sha}};
 if(route.startsWith('contents/'))return {type:'file',encoding:'base64',content:Buffer.from(JSON.stringify(contract)).toString('base64')};
 if(route.startsWith('issues/')&&route.includes('comments'))return [{user:{login:'coderabbitai[bot]'},body:recent(head),created_at:'2026-10-20T12:00:00Z'}];
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
 const list=[{user:{login:'coderabbitai[bot]'},body:recent(sha),created_at:'2026-10-20T11:00:00Z'}];assert.equal(independentCodeRabbit(list,head).completed,false);
});
test('04 moving main invalidates snapshot',async()=>{
 let c=0;const api=async name=>{if(name==='branches/main'){c++;if(c===2)return {protected:true,commit:{sha:'c'.repeat(40)}};}return mock()(name);};await assert.rejects(fetchVerifiedSnapshot({api,readProjects:projects}),/MAIN_MOVED/);
});
test('05 unavailable projects fail closed',async()=>{
 await assert.rejects(fetchVerifiedSnapshot({api:mock(),readProjects:async()=>({items:[]})}),/PROJECT_GATES_UNVERIFIED/);
});

test('07 full CodeRabbit comment page is blocked instead of trusting stale review',async()=>{
 const api=async route=>{
  if(route.startsWith('issues/')&&route.endsWith('/comments?per_page=100')){
   return Array.from({length:100},(_,i)=>({user:{login:'coderabbitai[bot]'},
    body:recent(head),
    created_at:new Date(Date.UTC(2026,9,20,12,0,i)).toISOString()}));
  }
  return mock()(route);
 };
 await assert.rejects(fetchVerifiedSnapshot({api,readProjects:projects}),/COMMENTS_PAGINATION_UNTRUSTED/);
});
test('06 closed historical issue is readable but cannot authorize execution',async()=>{
 const api=async route=>{if(route==='issues/511')return {number:511,state:'closed',labels:[]};return mock()(route);};
 const s=await fetchVerifiedSnapshot({api,readProjects:projects});
 assert.equal(s.issues[511].state,'closed');
});

test('08 bounded clean current-head marker permits only genuine reviewed SHA',()=>{
 const list=[{user:{login:'coderabbitai[bot]'},body:recent(head),created_at:'2026-10-20T11:00:00Z'}];
 assert.deepEqual(independentCodeRabbit(list,head),{head,completed:true,actionable:false});
});
test('09 mention of SHA outside bounded summary does not allow a clean review',()=>{
 const forged='<!-- recent_review_start -->\nNo actionable comments were generated in the recent review. 🎉\nHead: '+head+'\n<!-- recent_review_end -->';
 assert.equal(independentCodeRabbit([{user:{login:'coderabbitai[bot]'},body:forged}],head).completed,false);
});
test('10 contradictory clean and actionable count is blocked',()=>{
 const forged=recent(head).replace('<!-- recent_review_end -->','Actionable comments posted: 1\n<!-- recent_review_end -->');
 const result=independentCodeRabbit([{user:{login:'coderabbitai[bot]'},body:forged}],head);
 assert.notEqual(result.actionable,false);
 assert.equal(result.completed,false);
});
test('11 outside-diff actionable comments cannot pass',()=>{
 const forged=recent(head).replace('<!-- recent_review_end -->','Outside diff range comments (3)\n<!-- recent_review_end -->');
 const result=independentCodeRabbit([{user:{login:'coderabbitai[bot]'},body:forged}],head);
 assert.notEqual(result.actionable,false);
});
test('12 duplicate marked bot summaries are ambiguous, even if clean',()=>{
 const entry={user:{login:'coderabbitai[bot]'},body:recent(head)};
 assert.equal(independentCodeRabbit([entry,entry],head).completed,false);
});
