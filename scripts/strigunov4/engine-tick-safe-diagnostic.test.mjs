import test from 'node:test';
import assert from 'node:assert/strict';
import {safeNativeSourceReason,runContinuousWorker} from './ASI-STRIGUNOV4-RUNNER-BRIDGE-20261020.mjs';

const KNOWN='MODEL_PROPOSAL_PROVIDER_RESPONSE_UNKNOWN_NO_AUTOMATIC_RETRY';

test('logs only finite nonsecret engine diagnosis codes',()=>{
  assert.equal(safeNativeSourceReason(KNOWN),KNOWN);
  assert.equal(safeNativeSourceReason('MODEL_OUTCOME_UNKNOWN_BLOCKED_LANE_NO_REPLAY'),
    'MODEL_OUTCOME_UNKNOWN_BLOCKED_LANE_NO_REPLAY');
  assert.equal(safeNativeSourceReason('Authorization: Bearer private-token'),null);
  assert.equal(safeNativeSourceReason('MODEL_PROPOSAL_'+JSON.stringify({raw:'secret'})),null);
  assert.equal(safeNativeSourceReason({toString(){throw Error('MUST_NOT_COERCE');}}),null);
});

async function tick(mode,reason){
  const stop=new AbortController(),events=[];
  await runContinuousWorker({
    iteration:async()=>({mode,reason}),signal:stop.signal,
    wait:async()=>{stop.abort();},
    emit:e=>events.push(e)
  });
  assert.equal(events.length,1);
  return events[0];
}

test('WAITING logs known native model code without raw response',async()=>{
  const event=await tick('WAITING',KNOWN);
  assert.equal(event.reasonCode,KNOWN);
  assert.equal(event.mode,'WAITING');
  assert.equal(event.outcome,'IDLE_OR_PENDING');
  assert.equal('reason' in event,false);
});
test('unknown/untrusted reasons are never logged even on errors',async()=>{
  for(const mode of ['WAITING','BLOCKED','FAILED_LOCKED']){
    const event=await tick(mode,'Authorization: Bearer private-token');
    assert.equal(event.reasonCode,undefined);
    assert.equal('reason' in event,false);
  }
  assert.equal((await tick('REPORT_READY',KNOWN)).reasonCode,undefined);
});
