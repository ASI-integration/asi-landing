import test from 'node:test';
import assert from 'node:assert/strict';
import {proposeSourceWork} from './source-work-intake.mjs';

// An admitted S4-G2 fixture. No provider, host, credentials or network calls.
const task=Object.freeze({
  id:'wd-p0-trust-s4-g2',laneId:'p0-trust',
  repo:'ASI-integration/asi-landing',
  branch:'asi/p0-trusted-evidence-worker-20261029',
  baseSha:'a'.repeat(40),stage:'S4-G2',kind:'source-proposal',
  objective:'Add one bounded assertion to the approved test.',
  files:[{path:'scripts/strigunov4/source-publisher-handoff.test.mjs',
    beforeSha256:'b'.repeat(64)}]
});
const run=(output)=>proposeSourceWork({
  task,admittedTasks:[task],produce:async()=>output
});

test('non-sensitive, known producer failures survive intake without becoming a candidate',async()=>{
  for(const code of [
    'APPROVED_SOURCE_READ_FAILED',
    'SIGNED_PROVIDER_BUDGET_DENIED',
    'PROVIDER_REQUEST_UNKNOWN_NO_AUTOMATIC_RETRY',
    'PROVIDER_RESPONSE_UNKNOWN_NO_AUTOMATIC_RETRY',
    'PROVIDER_HTTP_401_NO_REPLAY',
    'PROVIDER_HTTP_429_NO_REPLAY',
    'PROVIDER_HTTP_500_NO_REPLAY',
    'PROVIDER_CONTENT_TYPE_INVALID_NO_REPLAY',
    'PROVIDER_MODEL_CHANGED_AFTER_RESERVATION',
    'PROVIDER_OUTPUT_INCOMPLETE_NO_REPLAY',
    'PROVIDER_OUTPUT_INVALID'
  ]) {
    const result=await run({status:'BLOCKED',reason:code,changes:[]});
    assert.equal(result.status,'BLOCKED',code);
    assert.equal(result.reason,code);
    assert.equal(result.authorized,false);
    assert.equal(result.candidate,null);
  }
});

test('unknown or injected producer reasons stay opaque and never grant authority',async()=>{
  for(const reason of [
    'APPROVED_BY_MODEL','PROVIDER_HTTP_302_NO_REPLAY',
    'PROVIDER_HTTP_699_NO_REPLAY','ERROR: secret token',
    'PROVIDER_HTTP_401_NO_REPLAY\\nPASSWORD=EXPOSED'
  ]) {
    const result=await run({status:'BLOCKED',reason,changes:[]});
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.reason,'PRODUCER_OUTPUT_NOT_VERIFIED');
    assert.equal(result.candidate,null);
  }
});

test('malformed failure shapes and fake proposals do not pass',async()=>{
  for(const output of [
    {status:'BLOCKED',reason:'PROVIDER_HTTP_401_NO_REPLAY',changes:[{}]},
    {status:'BLOCKED',reason:'PROVIDER_HTTP_401_NO_REPLAY',changes:[],secret:'token'},
    {status:'PROPOSED',changes:[]},
    {status:'PROPOSED',changes:[{path:'unrelated.js',content:'unsafe',beforeSha256:null}]}
  ]) {
    const result=await run(output);
    assert.equal(result.status,'BLOCKED');
    assert.equal(result.authorized,false);
    assert.equal(result.candidate,null);
  }
});
