import test from 'node:test';
import assert from 'node:assert/strict';
import {readAuthenticatedProviderSnapshot as readProvider} from '../check-demo-release.mjs';

function makeFixture(drift='stable') {
  const repository='ASI-integration/asi-landing';
  const baseSha='a'.repeat(40), headSha='b'.repeat(40);
  const now=Date.parse('2026-10-29T07:15:00Z');
  const expected={repository,number:552,baseSha,headSha,independentReviewerId:42};
  const pullRef={number:552,head:{sha:headSha},base:{sha:baseSha}};
  const pr={number:552,state:'open',user:{id:19},
    head:{sha:headSha,repo:{full_name:repository}},
    base:{ref:'main',sha:baseSha,repo:{full_name:repository}}};
  const runs=[
    {id:2,workflow_id:311380800,event:'pull_request',head_sha:headSha},
    {id:3,workflow_id:390653294,event:'pull_request_target',head_sha:baseSha},
  ].map(run=>({...run,run_attempt:1,status:'completed',conclusion:'success',
    repository:{full_name:repository},pull_requests:[pullRef],
    updated_at:'2026-10-29T07:14:00Z'}));
  const approval={id:10,user:{id:42},state:'APPROVED',commit_id:headSha,
    submitted_at:'2026-10-29T07:14:30Z'};
  let reviews=[approval], reviewReads=0;
  const calls=[];
  const fetchImpl=async(url,options)=>{
    const u=new URL(url);
    calls.push({route:u.pathname+u.search,options});
    let body;
    if(u.pathname.endsWith('/reviews')){
      reviewReads++;
      body=structuredClone(reviews);
      // A provider state change AFTER the first response has been copied,
      // while the PR base and HEAD remain unchanged.
      if(reviewReads===1) {
        if(drift==='dismiss')reviews=[{...approval,state:'DISMISSED'}];
        if(drift==='changes')reviews=[approval,{...approval,id:11,state:'CHANGES_REQUESTED',
          submitted_at:'2026-10-29T07:14:45Z'}];
        if(drift==='identity')reviews=[{...approval,user:{id:43}}];
      }
    } else if(u.pathname.includes('/actions/workflows/')){
      const id=Number(u.pathname.split('/').at(-2));
      const workflow_runs=runs.filter(r=>r.workflow_id===id);
      body={total_count:workflow_runs.length,workflow_runs};
    } else body=pr;
    return new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
  };
  return {input:{token:'offline-test-only',expected,fetchImpl,clock:()=>now},calls,
    getReviewReads:()=>reviewReads};
}

test('stable complete review inventories still produce non-authorizing evidence',async()=>{
  const f=makeFixture();const r=await readProvider(f.input);
  assert.equal(r.status,'PROVIDER_EVIDENCE_VERIFIED');
  assert.equal(r.authorized,false);
  assert.equal(f.getReviewReads(),2);
  assert.equal(r.receipt.requests,6);
});
for(const [drift,label] of [['dismiss','dismissal'],['changes','new change request'],
  ['identity','reviewer identity change']]) {
  test('review freshness denies '+label+' between authenticated GETs',async()=>{
    const f=makeFixture(drift);const r=await readProvider(f.input);
    assert.equal(r.authorized,false);
    assert.equal(r.status,'BLOCKED');
    assert.equal(r.reason,'PROVIDER_READER_REVIEW_DRIFT');
    assert.equal(f.getReviewReads(),2);
  });
}
