import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inspectPhase1Evidence,assessPhase2Gate,inspectCommitTrace,
 PHASE1_DOMAINS,PHASE1_SCENARIOS} from '../acceptance/strigunov-task20-boundaries.mjs';

const SHA='02e81db54e69d87978872151c40af3b9ec17825c';
const createEvidence=()=>({
 schema:1,run:'strig-t17-38573727019-1',source:SHA,status:'TECHNICAL_PHASE1_PASS',
 nativeExecuted:true,cleanup:'PASS',phase2:'BLOCK',p13Wire:'BLOCK',realAuthority:'BLOCK',canSend:false,
 instance:{version:170011,system_id:'12345'},
 closed:{sessions:0,requests:0,markers:0},
 peers:[
  {session_user:'task12_login_a',current_user:'task12_login_a',pid:91,port:55442,isolation:'serializable',privileged:false},
  {session_user:'task12_login_b',current_user:'task12_login_b',pid:92,port:55442,isolation:'serializable',privileged:false}
 ],
 cases:[
  ...PHASE1_DOMAINS.flatMap(domain=>['commit','rollback','race'].map(kind=>({case:domain+':'+kind,status:'PASS'}))),
  ...PHASE1_SCENARIOS.map(id=>({case:id,status:'PASS'}))
 ]
});
const mutate=(f)=>{const e=createEvidence();f(e);return e;};
const hold=(e,expected=SHA)=>{
 const result=inspectPhase1Evidence(e,expected);
 assert.equal(result.status,'HOLD');assert.equal(result.canApprove,false);assert.equal(result.canSend,false);
 assert.equal(result.scope,'SOURCE_ONLY_NON_AUTHORIZING');return result;
};

test('Phase1 exact 18 barriers and 12 scenarios are only a structural match',()=>{
 assert.equal(createEvidence().cases.length,30);
 const v=inspectPhase1Evidence(createEvidence(),SHA);
 assert.equal(v.status,'STRUCTURE_MATCH_ONLY');
 assert.equal(v.canApprove,false);assert.equal(v.canSend,false);
});
test('Phase2 always stays BLOCK even for structurally matched Phase1',()=>{
 const v=assessPhase2Gate(createEvidence(),SHA);
 assert.equal(v.status,'BLOCK');assert.equal(v.phase2,'NOT_RUN');
 assert.equal(v.operatorAuthority,'UNVERIFIED');assert.equal(v.canSend,false);
});
test('caller-supplied fake owner receipt cannot grant Phase2',()=>{
 const v=assessPhase2Gate(createEvidence(),SHA,{signed:true,owner:true,operator:true,consent:true});
 assert.equal(v.status,'BLOCK');assert.ok(v.reasons.includes('CALLER_RECEIPT_IS_NOT_AUTHORITY'));
});
for(const [name,fn] of [
 ['wrong reviewed SHA',e=>{e.source='f'.repeat(40);}],
 ['source absent',e=>{delete e.source;}],
 ['simulated instead of native',e=>{e.nativeExecuted=false;}],
 ['native HOLD',e=>{e.status='HOLD';}],
 ['cleanup blocked',e=>{e.cleanup='HOLD';}],
 ['phase2 claimed open',e=>{e.phase2='PASS';}],
 ['P13 claimed open',e=>{e.p13Wire='PASS';}],
 ['operator authority claimed',e=>{e.realAuthority='PASS';}],
 ['guest send flag claimed',e=>{e.canSend=true;}],
 ['leftover session',e=>{e.closed.sessions=1;}],
 ['leftover request',e=>{e.closed.requests=1;}],
 ['leftover marker',e=>{e.closed.markers=1;}],
 ['PG wrong major',e=>{e.instance.version=160009;}],
 ['missing barrier',e=>{e.cases.pop();}],
 ['duplicated barrier',e=>{e.cases[1]=e.cases[0];}],
 ['unknown barrier',e=>{e.cases[0]={case:'any:commit',status:'PASS'};}],
 ['failed native case',e=>{e.cases[0].status='FAIL';}],
 ['A peer privileged',e=>{e.peers[0].privileged=true;}],
 ['same connection A and B',e=>{e.peers[1].pid=e.peers[0].pid;}],
 ['A peer escalated current_user',e=>{e.peers[0].current_user='postgres';}],
 ['A peer wrong port',e=>{e.peers[0].port=5432;}],
 ['A peer wrong isolation',e=>{e.peers[0].isolation='read committed';}],
 ['B peer missing',e=>{e.peers.pop();}]
])test('Phase1 rejects '+name,()=>hold(mutate(fn)));
test('wrong expected SHA fails closed',()=>hold(createEvidence(),'b'.repeat(40)));
test('invalid evidence types fail closed',()=>{
 for(const v of [undefined,null,[],false,0,'PASS'])hold(v);
});
test('failed Phase1 cannot be used to open Phase2',()=>{
 const v=assessPhase2Gate(mutate(e=>{e.cleanup='HOLD';}),SHA);
 assert.equal(v.status,'BLOCK');assert.ok(v.reasons.includes('PHASE1_EVIDENCE_UNVERIFIED'));
});
const ambiguous=[
 ['unknown reply',['COMMIT_SUBMITTED','UNKNOWN_REPLY']],
 ['transport lost',['COMMIT_SUBMITTED','TRANSPORT_LOST']],
 ['timeout',['COMMIT_SUBMITTED','TIMEOUT']],
 ['rollback after submit',['COMMIT_SUBMITTED','ROLLBACK_REPLY']],
 ['no reply',['COMMIT_SUBMITTED']],
 ['ack without submit',['COMMIT_ACKED']],
 ['duplicate submit',['COMMIT_SUBMITTED','COMMIT_SUBMITTED']],
 ['retry after unknown',['COMMIT_SUBMITTED','TIMEOUT','COMMIT_SUBMITTED']],
 ['late ack after lost reply',['COMMIT_SUBMITTED','TRANSPORT_LOST','COMMIT_ACKED']],
 ['ack and duplicate submit',['COMMIT_SUBMITTED','COMMIT_ACKED','COMMIT_SUBMITTED']],
 ['ack then disconnection',['COMMIT_SUBMITTED','COMMIT_ACKED','TRANSPORT_LOST']],
 ['caller forged status',['COMMIT_SUBMITTED',{type:'COMMIT_ACKED'}]],
 ['invalid event',['COMMIT_SUBMITTED','success']],
 ['missing events',[]]
];
for(const [name,trace] of ambiguous)test('P13 holds '+name,()=>{
 const v=inspectCommitTrace(trace);
 assert.equal(v.status,'HOLD');assert.equal(v.canRetry,false);assert.equal(v.canSend,false);
 assert.equal(v.commit,'UNKNOWN');assert.ok(v.reasons.length>=1);
});
test('P13 clean ACK is NOT persistence readback or operator permission',()=>{
 const v=inspectCommitTrace(['COMMIT_SUBMITTED','COMMIT_ACKED']);
 assert.equal(v.status,'TECHNICAL_ACK_ONLY');
 assert.equal(v.commit,'ACK_OBSERVED_NOT_READBACK');assert.equal(v.attempts,1);
 assert.equal(v.canRetry,false);assert.equal(v.canSend,false);assert.equal(v.canApprove,false);
});
test('P13 cannot exceed one COMMIT submission',()=>{
 const v=inspectCommitTrace(['COMMIT_SUBMITTED','COMMIT_SUBMITTED','COMMIT_ACKED']);
 assert.equal(v.status,'HOLD');assert.equal(v.attempts,1);
});
test('P13 rejects unlimited or malformed traces',()=>{
 for(const v of [null,undefined,{},'ACK',Array(9).fill('COMMIT_SUBMITTED')])
  assert.equal(inspectCommitTrace(v).status,'HOLD');
});
test('Task20 source cannot import connectors or issue SQL',()=>{
 const src=readFileSync('scripts/acceptance/strigunov-task20-boundaries.mjs','utf8');
 const ioPattern=/\b(?:import\s|require\s*\(|fetch\s*\(|process\.env|execFileSync|spawn\s*\()|\.query\s*\(/;
 const sqlPattern=/\b(?:INSERT|UPDATE|DELETE|CREATE\s+ROLE|GH_TOKEN)\b|\bCOMMIT\s*;|secrets\./;
 assert.doesNotMatch(src,ioPattern);
 assert.doesNotMatch(src,sqlPattern);
 // Protect the guards themselves against optional chaining and punctuation blind spots.
 assert.match("e.client?.query('COMMIT;')",ioPattern);
 assert.match("e.client?.query('COMMIT;')",sqlPattern);
 assert.match('process.env.TOKEN',ioPattern);
 assert.match('secrets.TOKEN',sqlPattern);
});
test('Task17 native driver still excludes Phase2 and does not retry unknown commit',()=>{
 const lab=readFileSync('scripts/acceptance/strigunov-task17-lab.mjs','utf8');
 const scenario=readFileSync('scripts/acceptance/strigunov-task13-scenarios.mjs','utf8');
 assert.match(lab,/phase2:'BLOCK',p13Wire:'BLOCK',realAuthority:'BLOCK',canSend:false/);
 assert.doesNotMatch(lab,/task13-phase2\.sql|task12-overlay/);
 assert.match(scenario,/if\(commit\)return \{ok:false,status:'HOLD',uncertain:true/);
});
test('CodeRabbit Autofix stays disabled while reviews run',()=>{
 const config=readFileSync('.coderabbit.yaml','utf8');
 assert.match(config,/reviews:\s*\n\s*finishing_touches:\s*\n\s*autofix:\s*\n\s*enabled: false/);
});
