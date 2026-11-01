import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createResponsesCodeProducer} from './source-responses-provider.mjs';
import {proposeSourceWork} from './source-work-intake.mjs';
import {compileSourcePublisherHandoff} from './source-publisher-handoff.mjs';

const H40='a'.repeat(40),MODEL='gpt-6-astra',KEY='sk-test-only-do-not-call-real';
const task=(override={})=>({
  id:'coding-work-1',laneId:'engine',repo:'ASI-integration/asi-landing',
  branch:'asi/beget-one-engine-20261028',baseSha:H40,stage:'S4-G2',
  kind:'source-proposal',objective:'Add a bounded Python function that returns True.',
  files:[{path:'docs/coding-work.py',beforeSha256:null}],...override
});
const output=(changes=[{path:'docs/coding-work.py',content:'def ready():\n    return True\n'}])=>
  ({id:'resp-fixture',object:'response',created_at:1,status:'completed',
    model:MODEL,usage:{total_tokens:42},output:[{type:'message',role:'assistant',
      status:'completed',content:[{type:'output_text',text:JSON.stringify({status:'PROPOSED',changes})}]}]});
const transport=(res,record)=>async (url,init)=>{
  record.calls.push({url,method:init.method,headers:init.headers,body:JSON.parse(init.body)});
  return new Response(JSON.stringify(res),{status:200,headers:{'content-type':'application/json'}});
};
const instance=({response=output(),record={calls:[],admissions:[]},
  approve=true,files=[{path:'docs/coding-work.py',beforeSha256:null,content:''}],
  overrides={}}={})=>{
  const model=createResponsesCodeProducer({
    model:MODEL,apiKey:KEY,
    getContext:async({id,baseSha,paths})=>{
      assert.equal(id,'coding-work-1');assert.equal(baseSha,H40);
      assert.deepEqual(paths,['docs/coding-work.py']);return files;},
    admitRequest:async req=>{record.admissions.push(req);return {
      authorized:approve,taskId:req.taskId,baseSha:req.baseSha,model:req.model,
      maxOutputTokens:req.maxOutputTokens,pathDigest:req.pathDigest,operationId:'signed-native-test-1'};},
    transport:transport(response,record),...overrides
  });
  return {model,record};
};
test('actual Responses API wire format, model schema and no model tools',async()=>{
  const {model,record}=instance();
  const result=await model({id:'coding-work-1',laneId:'engine',baseSha:H40,
    repository:'ASI-integration/asi-landing',branch:'asi/beget-one-engine-20261028',
    objective:'Add a bounded Python function that returns True.',
    paths:Object.freeze(['docs/coding-work.py'])});
  assert.equal(result.status,'PROPOSED');
  assert.equal(result.changes.length,1);
  assert.equal(result.changes[0].beforeSha256,null);
  assert.equal(record.admissions.length,1);
  assert.equal(record.calls.length,1);
  const request=record.calls[0];
  assert.equal(request.url,'https://api.openai.com/v1/responses');
  assert.equal(request.method,'POST');
  assert.equal(request.body.model,MODEL);
  assert.equal(request.body.store,false);
  assert.deepEqual(request.body.tools,[]);
  assert.equal(request.body.tool_choice,'none');
  assert.equal(request.body.text.format.type,'json_schema');
  assert.equal(request.body.text.format.strict,true);
  assert.equal(request.body.text.format.schema.additionalProperties,false);
  assert(!JSON.stringify(request.body).includes(KEY));
});
test('source proposal flows to existing Publisher-shaped handoff without authority',async()=>{
  const t=task(),{model}=instance();
  const proposal=await proposeSourceWork({task:t,admittedTasks:[t],produce:model});
  assert.equal(proposal.status,'PROPOSAL_PREPARED');
  const handoff=compileSourcePublisherHandoff({task:t,admittedTasks:[t],proposal});
  assert.equal(handoff.status,'SOURCE_PREPARER_CANDIDATE');
  assert.equal(handoff.authorized,false);
  assert.equal(handoff.task.kind,'github-publisher');
  assert.equal(handoff.task.branch,'asi/engine-task/coding-work-1');
  assert.equal(handoff.task.changes[0].content,'def ready():\n    return True\n');
});
test('no native budget admission means NO provider request',async()=>{
  const {model,record}=instance({approve:false});
  const result=await model({id:'coding-work-1',baseSha:H40,repository:'ASI-integration/asi-landing',
    laneId:'engine',branch:'asi/beget-one-engine-20261028',objective:'Add a function',
    paths:['docs/coding-work.py']});
  assert.equal(result.status,'BLOCKED');
  assert.equal(result.reason,'SIGNED_PROVIDER_BUDGET_DENIED');
  assert.equal(record.calls.length,0);
});
test('unconfigured key, model or provider authority never contacts network',async()=>{
  for(const options of [{apiKey:null},{model:null},{admitRequest:null},
    {getContext:null},{maxOutputTokens:8193}]){
    const record={calls:[],admissions:[]};
    const {model}=instance({record,overrides:options});
    const res=await model({id:'coding-work-1',baseSha:H40,repository:'ASI-integration/asi-landing',
      laneId:'engine',branch:'asi/beget-one-engine-20261028',objective:'Code',
      paths:['docs/coding-work.py']});
    assert.equal(res.status,'BLOCKED');
    assert.equal(record.calls.length,0);
  }
});
test('missing task objective blocks BEFORE paid request',async()=>{
  const {model,record}=instance();
  const response=await model({id:'coding-work-1',baseSha:H40,repository:'ASI-integration/asi-landing',
    laneId:'engine',branch:'asi/beget-one-engine-20261028',paths:['docs/coding-work.py']});
  assert.equal(response.status,'BLOCKED');
  assert.equal(record.admissions.length,0);
});
test('unverified source SHA blocks BEFORE paid request',async()=>{
  const {model,record}=instance({files:[{path:'docs/coding-work.py',
    beforeSha256:'b'.repeat(64),content:'tampered'}]});
  const res=await model({id:'coding-work-1',baseSha:H40,repository:'ASI-integration/asi-landing',
    laneId:'engine',branch:'asi/beget-one-engine-20261028',objective:'Code',
    paths:['docs/coding-work.py']});
  assert.equal(res.status,'BLOCKED');
  assert.equal(record.calls.length,0);
});
test('paid request network timeout is unknown and never retried',async()=>{
  let n=0;
  const {model}=instance({overrides:{transport:async()=>{n++;throw Error('secret token')}}});
  const result=await model({id:'coding-work-1',baseSha:H40,repository:'ASI-integration/asi-landing',
    laneId:'engine',branch:'asi/beget-one-engine-20261028',objective:'Code',
    paths:['docs/coding-work.py']});
  assert.equal(result.reason,'PROVIDER_REQUEST_UNKNOWN_NO_AUTOMATIC_RETRY');
  assert.equal(n,1);
  assert(!JSON.stringify(result).includes('secret'));
});
test('refusal, incomplete response or extra model message never publishes',async()=>{
  for(const altered of [
    {...output(),status:'incomplete'},
    {...output(),output:[{type:'message',role:'assistant',content:[{type:'refusal',refusal:'No'}]}]},
    {...output(),output:[...output().output,...output().output]}
  ]){
    const {model}=instance({response:altered});
    const r=await model({id:'coding-work-1',baseSha:H40,repository:'ASI-integration/asi-landing',
      laneId:'engine',branch:'asi/beget-one-engine-20261028',objective:'Code',
      paths:['docs/coding-work.py']});
    assert.equal(r.status,'BLOCKED');
    assert.equal(r.reason,'PROVIDER_OUTPUT_INVALID');
  }
});
test('model cannot change path, file count or invent a second target',async()=>{
  for(const changes of [
    [{path:'src/other.py',content:'print(1)\n'}],
    [{path:'docs/coding-work.py',content:'print(1)\n'},{path:'src/other.py',content:'print(2)\n'}]
  ]){
    const {model}=instance({response:output(changes)});
    const r=await model({id:'coding-work-1',baseSha:H40,repository:'ASI-integration/asi-landing',
      laneId:'engine',branch:'asi/beget-one-engine-20261028',objective:'Code',
      paths:['docs/coding-work.py']});
    assert.equal(r.status,'BLOCKED');
  }
});
test('oversized or non-JSON response cannot be read as a source change',async()=>{
  const {model}=instance({overrides:{transport:async()=>new Response('x'.repeat(300000),
    {status:200,headers:{'content-type':'application/json'}})}});
  const r=await model({id:'coding-work-1',baseSha:H40,repository:'ASI-integration/asi-landing',
    laneId:'engine',branch:'asi/beget-one-engine-20261028',objective:'Code',
    paths:['docs/coding-work.py']});
  assert.equal(r.reason,'PROVIDER_RESPONSE_UNKNOWN_NO_AUTOMATIC_RETRY');
});
test('non-success provider HTTP is not retried or interpreted as code',async()=>{
  const {model}=instance({overrides:{transport:async()=>new Response('Unauthorized',
    {status:401,headers:{'content-type':'text/plain'}})}});
  const r=await model({id:'coding-work-1',baseSha:H40,repository:'ASI-integration/asi-landing',
    laneId:'engine',branch:'asi/beget-one-engine-20261028',objective:'Code',
    paths:['docs/coding-work.py']});
  assert.equal(r.reason,'PROVIDER_RESPONSE_UNKNOWN_NO_AUTOMATIC_RETRY');
});

test('host budget token must bind the exact read-file inventory',async()=>{
  const record={calls:[],admissions:[]};
  const {model}=instance({record,overrides:{admitRequest:async req=>({
    authorized:true,taskId:req.taskId,baseSha:req.baseSha,model:req.model,
    maxOutputTokens:req.maxOutputTokens,pathDigest:'0'.repeat(64),operationId:'forged-native'
  })}});
  const r=await model({id:'coding-work-1',baseSha:H40,
    repository:'ASI-integration/asi-landing',laneId:'engine',
    branch:'asi/beget-one-engine-20261028',objective:'Code',
    paths:['docs/coding-work.py']});
  assert.equal(r.reason,'SIGNED_PROVIDER_BUDGET_DENIED');
  assert.equal(record.calls.length,0);
});
test('a moving task cannot spend after source context completes',async()=>{
  let calls=0, paid=0;
  const moving={id:'coding-work-1',laneId:'engine',baseSha:H40,
    repository:'ASI-integration/asi-landing',branch:'asi/beget-one-engine-20261028',
    objective:'Authorized scope',paths:['docs/coding-work.py']};
  const produce=createResponsesCodeProducer({model:MODEL,apiKey:KEY,
    getContext:async()=>{
      moving.objective='Different instruction';
      return [{path:'docs/coding-work.py',beforeSha256:null,content:''}];
    },
    admitRequest:async()=>{paid++;return {authorized:true}},
    transport:async()=>{calls++;throw Error('should not call')}
  });
  const result=await produce(moving);
  assert.equal(result.reason,'TASK_CHANGED_DURING_CONTEXT_READ');
  assert.equal(paid,0);assert.equal(calls,0);
});
test('provider reservation binds the actual objective and exact source bytes',async()=>{
  const a={calls:[],admissions:[]};
  const first=instance({record:a});
  const t={id:'coding-work-1',laneId:'engine',baseSha:H40,
    repository:'ASI-integration/asi-landing',branch:'asi/beget-one-engine-20261028',
    objective:'Instruction alpha',paths:['docs/coding-work.py']};
  const r1=await first.model(t);assert.equal(r1.status,'PROPOSED');
  const firstDigest=a.admissions[0].pathDigest;
  const b={calls:[],admissions:[]};
  const second=instance({record:b});
  const r2=await second.model({...t,objective:'Instruction beta'});
  assert.equal(r2.status,'PROPOSED');
  assert.notEqual(firstDigest,b.admissions[0].pathDigest);
});
test('scope moved after charged reservation does not produce a paid request',async()=>{
  const t={id:'coding-work-1',laneId:'engine',baseSha:H40,
    repository:'ASI-integration/asi-landing',branch:'asi/beget-one-engine-20261028',
    objective:'Approved',paths:['docs/coding-work.py']};
  let calls=0;
  const produce=createResponsesCodeProducer({model:MODEL,apiKey:KEY,
    getContext:async()=>[{path:'docs/coding-work.py',beforeSha256:null,content:''}],
    admitRequest:async request=>{
      t.objective='MUTATED AFTER RESERVATION';
      return {authorized:true,taskId:request.taskId,baseSha:request.baseSha,
        model:request.model,maxOutputTokens:request.maxOutputTokens,
        pathDigest:request.pathDigest,operationId:'signed-native-test-1'};
    },
    transport:async()=>{calls++;return new Response('{}',{status:200})}
  });
  assert.equal((await produce(t)).reason,'TASK_CHANGED_AFTER_PAID_RESERVATION');
  assert.equal(calls,0);
});
test('a changed returned model is not accepted under a different signed model budget',async()=>{
  const {model}=instance({response:{...output(),model:'gpt-other'}});
  const r=await model({id:'coding-work-1',baseSha:H40,
    repository:'ASI-integration/asi-landing',laneId:'engine',
    branch:'asi/beget-one-engine-20261028',objective:'Code',
    paths:['docs/coding-work.py']});
  assert.equal(r.reason,'PROVIDER_MODEL_CHANGED_AFTER_RESERVATION');
});
test('tool calls alongside an assistant message are not silently ignored',async()=>{
  const {model}=instance({response:{...output(),output:[
    ...output().output,
    {type:'function_call',name:'shell',call_id:'untrusted',arguments:'{}'}
  ]}});
  const r=await model({id:'coding-work-1',baseSha:H40,
    repository:'ASI-integration/asi-landing',laneId:'engine',
    branch:'asi/beget-one-engine-20261028',objective:'Code',
    paths:['docs/coding-work.py']});
  assert.equal(r.reason,'PROVIDER_OUTPUT_INVALID');
});
