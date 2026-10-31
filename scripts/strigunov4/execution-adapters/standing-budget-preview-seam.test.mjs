import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {initializeState,digest} from './state.mjs';
import {createStandingRequestPreview} from './standing-request-guard.mjs';

const base='c'.repeat(40);
test('native preview seam requires independently pinned admission base and the actual execute transaction',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'asi-p0-preview-lease-'));
  try{
    const store=await initializeState(root);
    const result=await store.execute('github-publisher',async({ledger,transaction})=>{
      const opts={store,transaction,signedEnvelope:null,signedEvidence:null,
        request:{baseSha:base,headSha:null},comparison:{},
        providerExpected:{independentReviewerId:1234},expectedTrust:{},
        isolatedPreview:true,publisherPhases:true};
      assert.throws(()=>createStandingRequestPreview(opts),/STANDING_BASE_SHA_PIN_REQUIRED/);
      assert.throws(()=>createStandingRequestPreview({...opts,admissionBaseSha:'d'.repeat(40)}),
        /STANDING_BASE_SHA_PIN_REQUIRED/);
      const preview=createStandingRequestPreview({...opts,admissionBaseSha:base});
      assert.equal(await preview.beforeRequest(),false);
      const method='GET',route='branches/main',payloadSha256=digest('');
      const observation=await preview.reserve({method,route,payloadSha256,
        requestSha256:digest(JSON.stringify({method,route,payloadSha256}))});
      assert.equal(observation.status,'BLOCKED');
      assert.equal(observation.authorized,false);
      assert.equal(ledger.standingDelegationBudget,undefined);
      return null;
    },{},()=>{throw Error('unexpected-action');});
    assert.equal(result.mode,'WAITING');
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
