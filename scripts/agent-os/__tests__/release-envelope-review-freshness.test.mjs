import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectFreshIndependentReview as check} from './release-envelope-review-freshness.mjs';
const H='a'.repeat(40), OTHER='b'.repeat(40), NOW=1793390000000;
const ISO=new Date(NOW-2000).toISOString().replace('.000Z','Z');
const expected={repository:'ASI-integration/asi-landing',headSha:H,
  independentReviewerId:42,authorId:17,ownerId:207600140};
const approval=()=>({id:10,user:{id:42},state:'APPROVED',commit_id:H,submitted_at:ISO});
const other=()=>({id:9,user:{id:99},state:'COMMENTED',commit_id:H,submitted_at:ISO});
const run=(before,after,override={})=>check({before,after,expected:{...expected,...override},now:NOW});

test('two independent complete inventories with same fresh approval are non-authorizing',()=>{
  const r=run([other(),approval()],[approval(),other()]);
  assert.deepEqual(r,{status:'REVIEW_SNAPSHOT_UNCHANGED',authorized:false,reviewId:10,headSha:H});
});
test('approval dismissed between first and final review GET fails closed',()=>{
  const before=[approval()],after=[{...approval(),state:'DISMISSED'}];
  assert.equal(run(before,after).reason,'REVIEW_SNAPSHOT_DRIFT');
});
test('a newer change request after first read fails closed',()=>{
  const newer={...approval(),id:11,state:'CHANGES_REQUESTED'};
  assert.equal(run([approval()],[approval(),newer]).reason,'REVIEW_SNAPSHOT_DRIFT');
});
test('review disappearance, changed commit and reviewer identity all deny drift',()=>{
  for(const next of [[],[{...approval(),commit_id:OTHER}],
    [{...approval(),user:{id:43}}]])
    assert.equal(run([approval()],next).reason,'REVIEW_SNAPSHOT_DRIFT');
});
test('matching negative decisions do not authenticate an approval',()=>{
  for(const state of ['DISMISSED','CHANGES_REQUESTED']){
    const a=[{...approval(),state}];assert.equal(run(a,a).reason,'REVIEW_NOT_APPROVED');
  }
});
test('matching stale or wrong-HEAD approvals deny',()=>{
  const old=new Date(NOW-3600001).toISOString().replace(/\.\d{3}Z$/,'Z');
  for(const a of [[{...approval(),commit_id:OTHER}],[{...approval(),submitted_at:old}]])
    assert.equal(run(a,a).reason,'REVIEW_NOT_APPROVED');
});
test('same GitHub user as author or owner cannot satisfy independently pinned identity',()=>{
  for(const who of [{authorId:42},{ownerId:42}])
    assert.equal(run([approval()],[approval()],who).reason,'REVIEW_CONTEXT');
});
test('boxed SHA and invalid pinned identities deny before string regex',()=>{
  for(const headSha of [new String(H),[H],{toString:()=>H},OTHER.slice(1)])
    assert.equal(run([approval()],[approval()],{headSha}).reason,'REVIEW_CONTEXT');
});
test('getters, sparse histories and coercible review states deny without invocation',()=>{
  let hit=0;
  const x=approval();Object.defineProperty(x,'state',{get(){hit++;throw Error('unexpected');}});
  assert.equal(run([x],[approval()]).reason,'REVIEW_SNAPSHOT_SHAPE');assert.equal(hit,0);
  const y=[approval(),,other()];
  assert.equal(run(y,y).reason,'REVIEW_SNAPSHOT_SHAPE');
  const z=[{...approval(),state:new String('APPROVED')}];
  assert.equal(run(z,z).reason,'REVIEW_SNAPSHOT_SHAPE');
});
test('new negative decision in both captures supersedes older approval',()=>{
  const later=new Date(NOW-1000).toISOString().replace('.000Z','Z');
  const a=[approval(),{...approval(),id:12,state:'CHANGES_REQUESTED',submitted_at:later}];
  assert.equal(run(a,a).reason,'REVIEW_NOT_APPROVED');
});
