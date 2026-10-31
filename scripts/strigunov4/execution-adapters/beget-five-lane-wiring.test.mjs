import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {verifyBegetFiveLaneActivation} from './host-authority.mjs';
import {createResponsesSourceReviewer} from './beget-native-source-review.mjs';
import {createNativeFiveLanePublicationLoop} from './publication-loop.mjs';
import {isBegetV2RuntimeManifest} from './host-runtime.mjs';
import {BEGET_FIVE_LANE_SOURCE_ROOTS} from './host-package.mjs';
const sum=x=>createHash('sha256').update(x).digest('hex');
const pair=()=>generateKeyPairSync('ed25519');
const fingerprint=key=>sum(key.export({type:'spki',format:'der'}));
const signed=(value,key)=>{const payload=JSON.stringify(value);return {
  payload,signature:sign(null,Buffer.from(payload),key).toString('base64')
};};
function activation(){
  const key=pair();
  const value={
    schema:'asi.engine-beget-five-lane-activation.v1',
    repo:'ASI-integration/asi-landing',host:'pqukibofpo',
    user:'asi-engine',service:'asi-strigunov-agent.service',
    root:'/var/lib/asi-engine',runtime:'/opt/asi-engine',stage:'S4-G2',
    baseSha:'a'.repeat(40),notBefore:1000,expiresAt:1000000,
    githubApp:{appId:5514822,installationId:176281163},
    model:{name:'generation-model',reviewName:'independent-model',
      maxOutputTokens:1024,maxCalls:8,reserveMicrousdPerCall:100,
      maxPaidMicrousd:1000},
    ciPolicies:[{name:'validate',workflowId:311380800,event:'pull_request'},
      {name:'release_governance',workflowId:390653294,event:'pull_request_target'}]
  };
  for(const k of ['runtimeManifestSha256','catalogSha256','goalGraphSha256',
    'assessmentsSha256','fenceSha256','reviewsSha256','securityDigest',
    'policyDigest','verifierKeySha256','parentDigest'])value[k]='b'.repeat(64);
  value.ownerKeySha256=fingerprint(key.publicKey);
  const pem=key.publicKey.export({type:'spki',format:'pem'});
  return {key,value,pem};
}
test('actual Ed25519 owner signature gates exact v2 host, model and scope',()=>{
  const x=activation(),doc=signed(x.value,x.key.privateKey);
  assert.equal(verifyBegetFiveLaneActivation(doc,x.pem,1500).schema,
    'asi.engine-beget-five-lane-activation.v1');
  for(const change of [
    v=>{v.host='other';},v=>{v.model.reviewName=v.model.name;},
    v=>{v.model.maxPaidMicrousd=0;},v=>{v.ciPolicies=[];},
    v=>{v.runtimeManifestSha256='x';},v=>{v.expiresAt=400*86400000;}
  ]){
    const v=structuredClone(x.value);change(v);
    assert.throws(()=>verifyBegetFiveLaneActivation(
      signed(v,x.key.privateKey),x.pem,1500));
  }
  assert.throws(()=>verifyBegetFiveLaneActivation(doc,x.pem,1000001));
  assert.throws(()=>verifyBegetFiveLaneActivation({
    ...doc,signature:signed(x.value,pair().privateKey).signature
  },x.pem,1500));
});
test('a matching-looking unsigned host object cannot enter native publisher loop',
  async()=>{
    let called=false;
    await assert.rejects(createNativeFiveLanePublicationLoop({
      authority:{payload:{schema:'asi.engine-beget-five-lane-activation.v1',
        root:'/var/lib/asi-engine'},catalog:[1,2,3,4,5],
        revalidate:async()=>true,fencingWitness:async()=>true,
        authorizePublisher:async()=>({approved:true}),
        admission:{root:'/var/lib/asi-engine'},
        catalogDigest:'b'.repeat(64)},
      makeTransactionPorts:async()=>{called=true;}
    }),/LIVE_ADMISSION_REQUIRED/);
    assert.equal(called,false);
  });
const HEAD='a'.repeat(40),DELTA='b'.repeat(64);
test('second model can provide bound review without any tools or external network',
  async()=>{
    const diff='--- a/example.py\n+++ b/example.py\n@@ -1 +1 @@\n-a\n+b\n';
    const delta=sum(diff),calls=[];
    const reviewer=createResponsesSourceReviewer({
      model:'independent-model',generatorModel:'generation-model',
      apiKey:'test-key-never-sent',maxOutputTokens:1024,
      getPreparedDiff:async()=>diff,
      admitRequest:async request=>({...request,authorized:true,
        operationId:'inert-reservation'}),
      transport:async(url,options)=>{
        calls.push({url,request:JSON.parse(options.body)});
        const verdict={status:'PASS',baseSha:HEAD,deltaSha256:delta,findings:[]};
        return new Response(JSON.stringify({
          id:'response-fixture',status:'completed',model:'independent-model',
          output:[{type:'message',role:'assistant',
            content:[{type:'output_text',text:JSON.stringify(verdict)}]}]
        }),{status:200,headers:{'Content-Type':'application/json'}});
      }
    });
    const result=await reviewer({taskId:'task-a',baseSha:HEAD,
      deltaSha256:delta});
    assert.equal(result.status,'PASS',result.reason);
    assert.equal(result.independent,true);
    assert.equal(calls.length,1);
    assert.equal(calls[0].request.tools.length,0);
    assert.equal(calls[0].request.store,false);
    const mismatch=await reviewer({taskId:'task-a',baseSha:HEAD,
      deltaSha256:DELTA});
    assert.equal(mismatch.status,'FAILED');
    assert.equal(calls.length,1);
  });
test('reviewer cannot reuse generation model or authorize without native reservation',
  async()=>{
    let external=0;
    const reviewer=createResponsesSourceReviewer({
      model:'same',generatorModel:'same',apiKey:'test-key-never-sent',
      getPreparedDiff:async()=>{external++;return 'diff';},
      admitRequest:async()=>({authorized:true}),
      transport:async()=>{throw Error('unexpected');}
    });
    assert.equal((await reviewer({taskId:'task-a',baseSha:HEAD,
      deltaSha256:DELTA})).status,'FAILED');
    assert.equal(external,0);
  });

test('source-only v2 manifests require installer-compatible false and protected-reviewed wiring',()=>{
  const m={schema:'asi.beget-engine-source.v1',
    nativeFiveLaneWiring:'REVIEWED_PROTECTED_ACTIVE_RUNTIME_V1',
    installable:false,files:Array.from({length:41},(_,i)=>({path:'scripts/x'+i+'.mjs'})),
    nodeSha256:'a'.repeat(64),bwrapSha256:'a'.repeat(64),
    unitSha256:'a'.repeat(64),catalogSha256:'a'.repeat(64)};
  assert.equal(isBegetV2RuntimeManifest(m),true);
  assert.equal(isBegetV2RuntimeManifest({...m,installable:true}),false);
  assert.equal(isBegetV2RuntimeManifest({...m,nativeFiveLaneWiring:undefined}),false);
  assert.equal(isBegetV2RuntimeManifest({...m,files:m.files.slice(0,20)}),false);
  assert.equal(isBegetV2RuntimeManifest({...m,nodeSha256:'unknown'}),false);
  assert.equal(BEGET_FIVE_LANE_SOURCE_ROOTS.includes(
    'strigunov4/execution-adapters/standing-request-guard.mjs'),true);
});
