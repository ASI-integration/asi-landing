import test from 'node:test';
import assert from 'node:assert/strict';
import {safeNativeSourceReason,runContinuousWorker} from './ASI-STRIGUNOV4-RUNNER-BRIDGE-20261020.mjs';

test('safe provider HTTP codes survive strict redaction, arbitrary payloads do not',()=>{
  for(const status of [400,401,403,429,500,503]){
    const code='MODEL_PROPOSAL_PROVIDER_HTTP_'+status+'_NO_REPLAY';
    assert.equal(safeNativeSourceReason(code),code);
  }
  assert.equal(safeNativeSourceReason('MODEL_PROPOSAL_PROVIDER_CONTENT_TYPE_INVALID_NO_REPLAY'),
    'MODEL_PROPOSAL_PROVIDER_CONTENT_TYPE_INVALID_NO_REPLAY');
  assert.equal(safeNativeSourceReason('MODEL_PROPOSAL_PROVIDER_OUTPUT_INCOMPLETE_NO_REPLAY'),
    'MODEL_PROPOSAL_PROVIDER_OUTPUT_INCOMPLETE_NO_REPLAY');
  for(const untrusted of ['MODEL_PROPOSAL_PROVIDER_HTTP_401_NO_REPLAY TOKEN=sk-secret',
    'MODEL_PROPOSAL_PROVIDER_HTTP_999_NO_REPLAY',
    'MODEL_PROPOSAL_PROVIDER_HTTP_401_NO_REPLAY\nAuthorization: secret',
    'MODEL_PROPOSAL_PROVIDER_HTTP_401_NO_REPLAY\0']){
    assert.equal(safeNativeSourceReason(untrusted),null);
  }
});
test('blocked and waiting ticks expose only vetted reason codes',async()=>{
  const items=[
    {mode:'BLOCKED',reason:'MODEL_PROPOSAL_PROVIDER_HTTP_401_NO_REPLAY'},
    {mode:'WAITING',reason:'MODEL_PROPOSAL_PROVIDER_OUTPUT_INCOMPLETE_NO_REPLAY'},
    {mode:'BLOCKED',reason:'unauthorized body sk-secret'},
  ];
  const seen=[],stop=new AbortController();let i=0;
  await runContinuousWorker({signal:stop.signal,
    iteration:async()=>items[i++],
    wait:async()=>{if(i>=items.length)stop.abort();},
    emit:entry=>seen.push(entry)
  });
  assert.equal(seen.length,3);
  assert.equal(seen[0].reasonCode,'MODEL_PROPOSAL_PROVIDER_HTTP_401_NO_REPLAY');
  assert.equal(seen[1].reasonCode,'MODEL_PROPOSAL_PROVIDER_OUTPUT_INCOMPLETE_NO_REPLAY');
  assert.equal('reasonCode' in seen[2],false);
  assert.equal(JSON.stringify(seen).includes('sk-secret'),false);
});
