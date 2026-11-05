import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createResponsesCodeProducer} from './source-responses-provider.mjs';

const MODEL='gpt-4.1-mini',BASE='e'.repeat(40);
const PATH='scripts/strigunov4/example.mjs';
const ORIGINAL='export function answer() { return 1; }\n';
const sha=s=>createHash('sha256').update(s).digest('hex');
const makeTask=()=>({
  id:'wd-provider-fixture',laneId:'engine',baseSha:BASE,
  repository:'ASI-integration/asi-landing',branch:'asi/test',
  objective:'Change answer from 1 to 2 within the admitted source file.',
  paths:[PATH]
});
const output=(changes,extra={})=>({
  status:'completed',model:MODEL,...extra,
  output:[{type:'message',role:'assistant',status:'completed',
    content:[{type:'output_text',text:JSON.stringify({status:'PROPOSED',changes})}]}]
});
function setup({file=ORIGINAL,sourceIsNew=false,body,code=200,contentType='application/json',
  repoOption='ASI-integration/asi-landing'}={}){
  const seen={calls:0,admitted:0,wire:null};
  const produce=createResponsesCodeProducer({
    model:MODEL,apiKey:'sk-fixture-never-real',maxOutputTokens:1024,
    allowedRepository:repoOption,
    getContext:async()=>[{path:PATH,beforeSha256:sourceIsNew?null:sha(file),content:file}],
    admitRequest:async r=>{
      seen.admitted++;return {authorized:true,taskId:r.taskId,baseSha:r.baseSha,
        model:r.model,maxOutputTokens:r.maxOutputTokens,pathDigest:r.pathDigest,
        operationId:'model-fixture-1'};
    },
    transport:async(_url,init)=>{
      seen.calls++;seen.wire=JSON.parse(init.body);
      return new Response(typeof body==='string'?body:JSON.stringify(body),{
        status:code,headers:{'content-type':contentType}
      });
    }
  });
  return {produce,seen};
}
test('1024-token protocol uses bounded unique hunks, not complete rewritten sources',async()=>{
  const fixture=setup({body:output([{path:PATH,hunks:[{find:'return 1;',replace:'return 2;'}]}])});
  const result=await fixture.produce(makeTask());
  assert.equal(result.status,'PROPOSED');
  assert.equal(result.changes[0].content,'export function answer() { return 2; }\n');
  assert.equal(fixture.seen.calls,1);
  assert.equal(fixture.seen.wire.max_output_tokens,1024);
  assert.equal(fixture.seen.wire.store,false);
  assert.deepEqual(fixture.seen.wire.tools,[]);
  assert.equal(fixture.seen.wire.text.format.strict,true);
  assert.equal(fixture.seen.wire.text.format.schema.properties.changes.items.properties.hunks.type,'array');
});
test('new empty admitted file can be created by one empty-find hunk',async()=>{
  const fixture=setup({file:'',sourceIsNew:true,
    body:output([{path:PATH,hunks:[{find:'',replace:'export const ready=true;\n'}]}])});
  const result=await fixture.produce(makeTask());
  assert.equal(result.status,'PROPOSED');
  assert.equal(result.changes[0].beforeSha256,null);
  assert.equal(result.changes[0].content,'export const ready=true;\n');
});
test('ambiguous find is rejected after one claim; never replays',async()=>{
  const fixture=setup({file:'hello hello',
    body:output([{path:PATH,hunks:[{find:'hello',replace:'bye'}]}])});
  const result=await fixture.produce(makeTask());
  assert.equal(result.reason,'PROVIDER_OUTPUT_INVALID');
  assert.equal(fixture.seen.admitted,1);
  assert.equal(fixture.seen.calls,1);
});
test('HTTP 401 is diagnosed without exposing response body and is not replayed',async()=>{
  const fixture=setup({body:'SECRET-UNTRUSTED-ERROR',code:401,contentType:'text/plain'});
  const result=await fixture.produce(makeTask());
  assert.equal(result.reason,'PROVIDER_HTTP_401_NO_REPLAY');
  assert(!JSON.stringify(result).includes('SECRET'));
  assert.equal(fixture.seen.calls,1);
});
test('HTTP 400 is distinguished from model-output problems without replay',async()=>{
  const fixture=setup({body:'malformed request',code:400,contentType:'text/plain'});
  assert.equal((await fixture.produce(makeTask())).reason,'PROVIDER_HTTP_400_NO_REPLAY');
  assert.equal(fixture.seen.calls,1);
});
test('incomplete 200 response is identified without replay',async()=>{
  const fixture=setup({body:output([], {status:'incomplete'})});
  assert.equal((await fixture.produce(makeTask())).reason,'PROVIDER_OUTPUT_INCOMPLETE_NO_REPLAY');
  assert.equal(fixture.seen.calls,1);
});
test('a substituted model remains blocked',async()=>{
  const fixture=setup({body:output([{path:PATH,hunks:[{find:'return 1;',replace:'return 2;'}]}],
    {model:'gpt-4.1'})});
  assert.equal((await fixture.produce(makeTask())).reason,'PROVIDER_MODEL_CHANGED_AFTER_RESERVATION');
  assert.equal(fixture.seen.calls,1);
});

test('provider rejects unrelated product repository before paid reservation by default',async()=>{
 const other={...makeTask(),repository:'ASI-integration/asi-booking'};
 const fx=setup({body:output([{path:PATH,hunks:[{find:'return 1;',replace:'return 2;'}]}])});
 const result=await fx.produce(other);
 assert.equal(result.reason,'SIGNED_TASK_OBJECTIVE_OR_SOURCE_REQUIRED');
 assert.equal(fx.seen.admitted,0);assert.equal(fx.seen.calls,0);
});
test('signed host can pin a different repository without changing wire/budget protocol',async()=>{
 const other={...makeTask(),repository:'ASI-integration/asi-booking'};
 const fx=setup({repoOption:'ASI-integration/asi-booking',
   body:output([{path:PATH,hunks:[{find:'return 1;',replace:'return 2;'}]}])});
 const result=await fx.produce(other);
 assert.equal(result.status,'PROPOSED');
 assert.equal(fx.seen.admitted,1);assert.equal(fx.seen.calls,1);
 const input=JSON.parse(fx.seen.wire.input[0].content[0].text);
 assert.equal(input.repo,'ASI-integration/asi-booking');
 assert.equal(fx.seen.wire.max_output_tokens,1024);
});
test('invalid repository configuration never reserves a model request',async()=>{
 const fx=setup({repoOption:['ASI-integration/asi-landing'],
   body:output([{path:PATH,hunks:[{find:'return 1;',replace:'return 2;'}]}])});
 assert.equal((await fx.produce(makeTask())).reason,'SIGNED_TASK_OBJECTIVE_OR_SOURCE_REQUIRED');
 assert.equal(fx.seen.admitted,0);assert.equal(fx.seen.calls,0);
});
