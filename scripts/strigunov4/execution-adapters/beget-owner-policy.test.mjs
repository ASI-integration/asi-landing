import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createBegetChecks} from './host-checks.mjs';
import {acceptedReviewEvidence} from './github-publisher.mjs';
import {digest} from './state.mjs';

const POLICY='a'.repeat(64),HEAD='b'.repeat(40),BASE='c'.repeat(40);
function task(id) {
  const filename='scripts/strigunov4/test_'+id+'.py';
  const content='import unittest\nclass TestWitness(unittest.TestCase):\n def test_ok(self): self.assertTrue(True)\n';
  return {id,sha:BASE,branch:'asi/engine-task/'+id,changes:[{path:filename,content}]};
}
function delta(t) {
  return digest(JSON.stringify([{path:t.changes[0].path,beforeSha256:null,
    afterSha256:digest(t.changes[0].content)}]));
}
test('only exact-bound owner G2 review evidence is accepted',()=>{
  const owner={independent:false,ownerVerifiedCi:true,reviewPolicySha256:POLICY};
  assert.equal(acceptedReviewEvidence(owner,'S4-G2',POLICY),true);
  for(const [v,stage,policy] of [
    [owner,'S4-G1',POLICY],[owner,'S4-G2','d'.repeat(64)],
    [{...owner,independent:true},'S4-G2',POLICY],
    [{...owner,ownerVerifiedCi:false},'S4-G2',POLICY],
    [{...owner,reviewPolicySha256:undefined},'S4-G2',POLICY],
    [{independent:false},'S4-G2',POLICY]
  ])assert.equal(acceptedReviewEvidence(v,stage,policy),false);
  assert.equal(acceptedReviewEvidence({independent:true},'S4-G1',undefined),true);
});
for(const mode of ['asi.owner-ci-delta-review.v1','asi.offline-delta-review.v1']){
  test('signed exact two-delta policy preserves review identity: '+mode,async t=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'asi-beget-owner-review-'));
    t.after(()=>fs.rm(root,{recursive:true,force:true}));
    const catalog=[task('identity'),task('races')];
    for(const item of catalog){
      const filename=path.join(root,'scratchpads',item.id,item.changes[0].path);
      await fs.mkdir(path.dirname(filename),{recursive:true});
      await fs.writeFile(filename,item.changes[0].content);
    }
    const now=Date.now();
    const reviews={schema:mode,repository:'ASI-integration/asi-landing',
      notBefore:now-30000,expiresAt:now+30000,
      tasks:catalog.map(item=>({id:item.id,baseSha:BASE,status:'PASS',findings:0,deltaSha256:delta(item)}))};
    let provenance=0;
    const checks=await createBegetChecks({root,catalog,reviewsRaw:JSON.stringify(reviews),reviewPolicySha256:POLICY,
      revalidate:async()=>{},verifyReviewProvenance:async()=>{provenance++},clock:()=>now});
    await checks.verifyReviews();
    const item=catalog[0], proof=await checks.independentReview({taskId:item.id,baseSha:BASE,deltaSha256:delta(item)});
    const owner=mode==='asi.owner-ci-delta-review.v1';
    assert.equal(proof.independent,!owner);
    assert.equal(proof.ownerVerifiedCi,owner);
    assert.equal(acceptedReviewEvidence(proof,'S4-G2',POLICY),true);
    const published=await checks.publishedReview.verify({id:item.id,repo:'ASI-integration/asi-landing',
      pr:100,sha:HEAD,baseSha:BASE,branch:item.branch,policySha256:POLICY,deltaSha256:delta(item)});
    assert.equal(published.independent,!owner);
    assert.equal(published.ownerVerifiedCi,owner);
    assert.equal(acceptedReviewEvidence(published,'S4-G2',POLICY),true);
    assert.equal(provenance,3);
    await assert.rejects(()=>checks.independentReview({taskId:item.id,baseSha:BASE,deltaSha256:'0'.repeat(64)}),
      /OFFLINE_REVIEW_UNVERIFIED/);
  });
}
