// Acceptance support ONLY. All GitHub writes stay on the existing loopback fixture.
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fixture,makeLoop} from './publisher-fixture.mjs';
import {initializeRoutingState} from '../../global-dispatcher/dispatcher.mjs';
import {stagePolicyHash} from './stage-authority.mjs';
import {digest} from './state.mjs';
export const readState=async(f,name)=>JSON.parse(await fs.readFile(path.join(f.root,'state',name),'utf8'));
export async function closedFixture(t,options={}){
 const f=await fixture(t,{distinctWorkOrders:true,...options}),now={value:1000000};
 const routing=path.join(f.base,'routing');await fs.mkdir(routing,{mode:0o700});await initializeRoutingState(routing);
 const policy={schema:'asi.stage-authority.v1',repository:'ASI-integration/asi-landing',stage:'S4-G1',issue:511,
  baseSha:f.sha,notBefore:now.value-1000,expiresAt:now.value+86400000,
  tasks:f.catalog.map(t=>({id:t.id,workOrderId:t.workOrderId,branch:t.branch,baseSha:t.sha,paths:t.changes.map(c=>c.path),
   operations:['create-tree','create-commit','create-branch','create-draft-pr']}))};
 const stamp=new Date(now.value).toISOString();
 const comments=[{body:'ASI-OWNER-STAGE-APPROVE:S4-G1:511:'+stagePolicyHash(policy),user:{id:207600140},created_at:stamp,updated_at:stamp}];
 const closedLoop={stateDir:routing,policy,readTrustedComments:async()=>structuredClone(comments),maxTicks:8};
 const reviewPolicy=digest('fixture-local-independent-review-v1: no remote model or CodeRabbit');
 const independentReview=async e=>{
  const task=f.catalog.find(t=>t.id===e.taskId),file=path.join(f.root,'scratchpads',e.taskId,task.changes[0].path);
  // Separate process reopens prepared bytes and independently validates the exact allowed change.
  execFileSync('/usr/bin/python3',['-I','-S','-c',
   'import pathlib,sys; b=pathlib.Path(sys.argv[1]).read_bytes(); assert b == sys.argv[2].encode(); assert b.startswith(b"VALUE = "); assert len(b.splitlines()) == 1',
   file,task.changes[0].content],{timeout:1000,env:{PATH:'/usr/bin:/bin'}});
  return {...e,status:'PASS',independent:true,evidenceId:'fixture-independent-process'};
 };
 const publishedReview={policySha256:reviewPolicy,verify:async p=>{
  const pr=f.pulls.get(p.pr);if(pr?.head.sha!==p.sha||pr?.base.sha!==p.baseSha)throw Error('FIXTURE_REVIEW_PIN');
  return {status:'PASS',repo:p.repo,pr:p.pr,head:p.sha,baseSha:p.baseSha,policySha256:p.policySha256,
   independent:true,evidenceSha256:digest(JSON.stringify({pr:p.pr,head:p.sha,delta:p.deltaSha256,policy:p.policySha256}))};
 }};
 return Object.assign(f,{now,routing,policy,comments,closedLoop,independentReview,publishedReview});
}
export const makeClosedLoop=(f,options={})=>makeLoop(f,{enginePilot:true,now:f.now,closedLoop:f.closedLoop,
 independentReview:f.independentReview,publishedReview:f.publishedReview,...options});
export const tick=loop=>loop.poll({execute:true});
