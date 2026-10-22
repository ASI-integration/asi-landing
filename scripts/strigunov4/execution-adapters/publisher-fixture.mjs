// TEST SUPPORT ONLY: loopback GitHub protocol service; never a production provider.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {initializeState,digest} from './state.mjs';
import {createPublicationLoop} from './publication-loop.mjs';
import {createPublisherTransport} from './publisher-transport.mjs';
import {createGitHubReader,BOT_ID} from './github-readonly.mjs';
const repo='ASI-integration/asi-landing',prefix='/repos/'+repo+'/';
export const target='scripts/strigunov4/protected_c4_unit_apply.py';
const git=(cwd,args,input)=>execFileSync('/usr/bin/git',args,{cwd,input,encoding:'utf8',env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_AUTHOR_NAME:'Fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid'}}).trim();
const oid=(kind,text)=>createHash('sha1').update(`${kind} ${Buffer.byteLength(text)}\0`).update(text).digest('hex');
export async function fixture(t,options={}){
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'asi-publisher-')),root=path.join(base,'isolated'),legacy=path.join(base,'legacy');
 await fs.mkdir(root,{mode:0o700});await fs.mkdir(legacy,{mode:0o700});await initializeState(root);
 await fs.writeFile(path.join(legacy,'receipts.json'),JSON.stringify({version:1,completed:[]}));
 t.after(()=>fs.rm(base,{recursive:true,force:true}));
 const seed=path.join(base,'seed');await fs.mkdir(path.join(seed,path.dirname(target)),{recursive:true});
 await fs.writeFile(path.join(seed,target),'VALUE = 1\n');git(seed,['init','-q']);git(seed,['add','.']);git(seed,['commit','-qm','fixture']);
 const sha=git(seed,['rev-parse','HEAD']);
 const catalog=['fixture-a','fixture-b'].map((id,i)=>({id,kind:'github-publisher',stage:'S4-G1',workOrderId:'g1-unit-apply-source',repo,sha,pr:null,
  branch:'asi/engine-task/'+id,changes:[{path:target,beforeSha256:digest('VALUE = 1\n'),content:`VALUE = ${i+2}\n`}]}));
 for(const task of catalog){const dir=path.join(root,'scratchpads',task.id);git(base,['clone','-q','--no-hardlinks',seed,dir]);git(dir,['checkout','--detach','-q']);await fs.chmod(dir,0o700);}
 const prs=Object.fromEntries([[509,'b3c8ff2e4904b0b503197d29aa217773918831bc'],[508,'8ac8e8ac11e39ac070ccc058218e3b73190cb43f'],[520,'6693312b0a94b8afcee3a34907055ce301a5fb3e']].map(([number,head])=>[number,{number,head,state:'open',merged:false}]));
 const snapshot={mainSha:sha,contract:{schemaVersion:'asi.demo-release.v1',releaseId:'STRIGUNOV4-READY-FOR-DEMO',state:'FROZEN_ON_OWNER_MERGE',
  stages:[1,2,3,4,5,6].map(i=>({id:`S4-G${i}`,status:i===1?'IN_PROGRESS':'NOT_STARTED',proof:[],files:i===1?[target]:[],
  plannedFiles:i===1?[target,'.github/workflows/strigunov4-c4-unit-apply.yml','scripts/strigunov4/test_protected_c4_unit_apply.py']:[]}))},
  issues:{511:{number:511,state:'open',labels:['agent-source-ready']}},project:{511:'PREPARATION_ONLY'},prs,
  checks:{509:{head:prs[509].head,validate:'success',release_governance:'success'}},reviews:{509:{head:prs[509].head,completed:true,actionable:false}},ledger:{}};
 const trees=new Map(),commits=new Map(),refs=new Map(),pulls=new Map(),writes=[],requests=[];
 const baseTree=git(seed,['rev-parse','HEAD^{tree}']);
 const leaves=git(seed,['ls-tree','-r',sha]).split('\n').map(line=>{const [meta,p]=line.split('\t'),[mode,type,hash]=meta.split(' ');return {path:p,mode,type,sha:hash};});
 trees.set(baseTree,{sha:baseTree,truncated:false,tree:leaves});commits.set(sha,{sha,tree:{sha:baseTree},parents:[]});
 const state={main:sha,ci:'success',review:'Review completed',...options};
 const server=http.createServer(async(req,res)=>{try{
  requests.push({method:req.method,url:req.url});const url=new URL(req.url,'http://localhost'),route=url.pathname.startsWith(prefix)?url.pathname.slice(prefix.length):url.pathname;
  let body='';for await(const c of req)body+=c;const data=body?JSON.parse(body):null;let result;
  if(req.method==='POST'&&route!=='/graphql')writes.push(route);
  if(route==='branches/main')result={protected:true,commit:{sha:state.main}};
  else if(route.startsWith('git/matching-refs/')){const ref=route.slice('git/matching-refs/'.length);result=[...refs].filter(([r])=>r.startsWith('refs/'+ref)).map(([r,head])=>({ref:r,object:{sha:head,type:'commit'}}));}
  else if(route==='git/trees'&&req.method==='POST'){
   const tree=structuredClone(trees.get(data.base_tree).tree);for(const e of data.tree){const old=tree.find(x=>x.path===e.path);Object.assign(old,{sha:oid('blob',e.content)});}
   const hash=oid('tree',JSON.stringify(tree));trees.set(hash,{sha:hash,truncated:false,tree});result={sha:hash};
  }else if(route.startsWith('git/trees/')){result=structuredClone(trees.get(route.split('/').at(-1)));if(state.badTree&&result.sha!==baseTree)result.tree[0].mode='100755';}
  else if(route==='git/commits'&&req.method==='POST'){const hash=oid('commit',JSON.stringify(data));commits.set(hash,{sha:hash,tree:{sha:data.tree},parents:data.parents.map(sha=>({sha}))});result={sha:hash};}
  else if(route.startsWith('git/commits/')){result=commits.get(route.split('/').at(-1));}
  else if(route==='git/refs'&&req.method==='POST'){if(refs.has(data.ref)){res.writeHead(422);res.end('{}');return;}refs.set(data.ref,data.sha);result={ref:data.ref,object:{sha:data.sha,type:'commit'}};}
  else if(route==='pulls'&&req.method==='POST'){
   const number=600+pulls.size,head=refs.get('refs/heads/'+data.head);result={number,title:data.title,body:data.body,state:'open',merged:false,draft:data.draft,changed_files:1,
    head:{sha:head,ref:data.head,repo:{full_name:repo}},base:{sha:state.main,ref:'main',repo:{full_name:repo}},html_url:`https://github.com/${repo}/pull/${number}`};pulls.set(number,result);
  }else if(route==='pulls')result=[...pulls.values()].filter(p=>url.searchParams.get('head')==='ASI-integration:'+p.head.ref);
  else if(/^pulls\/\d+\/files$/.test(route)){const p=pulls.get(Number(route.split('/')[1])),commit=commits.get(p.head.sha);result=trees.get(commit.tree.sha).tree.map(e=>({filename:e.path,status:'modified',sha:e.sha}));}
  else if(/^pulls\/\d+$/.test(route))result=pulls.get(Number(route.split('/')[1]));
  else if(route==='actions/runs'){
   const head=url.searchParams.get('head_sha'),event=url.searchParams.get('event');
   const pr=[...pulls.values()].find(p=>event==='pull_request_target'&&state.targetContext!=='head'?p.base.sha===head:p.head.sha===head);
   const ids=state.targetGovernance?(event==='pull_request'?[10]:[390653294]):[10,20];
   result=pr?{total_count:ids.length,workflow_runs:ids.map((workflow_id,i)=>({id:workflow_id,workflow_id,head_sha:state.staleCi?'f'.repeat(40):head,event,
    head_branch:state.wrongTargetRunBranch&&event==='pull_request_target'?
      (state.targetContext==='head'?'main':pr.head.ref):
      event==='pull_request_target'&&state.targetContext!=='head'?'main':pr.head.ref,
    repository:{full_name:repo},head_repository:{full_name:repo},pull_requests:
    state.targetContext==='head'&&event==='pull_request_target'?[]:
    [{number:pr.number,head:{sha:state.wrongAssociation?'f'.repeat(40):pr.head.sha,ref:pr.head.ref},
      base:{sha:state.wrongTargetBaseAssoc&&event==='pull_request_target'?'f'.repeat(40):pr.base.sha,ref:'main'}}],run_attempt:1,status:state.ci==='pending'?'in_progress':'completed',conclusion:state.ci==='pending'?null:state.ci,index:i}))}:{total_count:0,workflow_runs:[]};
  }else if(/^actions\/runs\/\d+\/attempts\/1\/jobs$/.test(route)){const id=Number(route.split('/')[2]),pr=[...pulls.values()].at(-1);
   result={total_count:1,jobs:[{id:id+100,run_id:id,
    head_sha:state.wrongTargetJobSha&&id===390653294?
      (state.targetContext==='head'?state.main:pr.head.sha):
      id===390653294&&state.targetContext!=='head'?state.main:pr.head.sha,
    name:id===10?'validate':'release_governance',status:'completed',conclusion:state.ci,steps:[{number:1,status:'completed',conclusion:'success'}]}]};
  }else if(/^actions\/runs\/\d+$/.test(route)){const pr=[...pulls.values()].at(-1);result={head_sha:Number(route.split('/')[2])===390653294&&state.targetContext!=='head'?state.main:pr.head.sha,
    run_attempt:1,status:'completed',conclusion:state.ci};}
  else if(/^commits\/[a-f0-9]+\/statuses$/.test(route)){result=[{id:1,context:'CodeRabbit',creator:{id:BOT_ID},state:state.review==='pending'?'pending':'success',description:state.review,created_at:'2026-10-22T10:00:00Z'}];if(state.failDuringReview)state.ci='failure';}
  else if(/^pulls\/\d+\/reviews$/.test(route)){const pr=pulls.get(Number(route.split('/')[1]));result=[{id:2,user:{id:BOT_ID},state:'COMMENTED',commit_id:pr.head.sha,body:'**Actionable comments posted: 0**'}];}
  else if(/^issues\/\d+\/comments$/.test(route))result=[];
  else if(route==='/graphql'){const pr=pulls.get(data.variables.number);result={data:{repository:{pullRequest:{headRefOid:pr.head.sha,reviewThreads:{pageInfo:{hasNextPage:false},nodes:[]}}}}};}
  else throw Error('UNKNOWN_FIXTURE_ROUTE');
  if(req.method==='POST'&&route===state.loseResponse){state.lost=true;return;}
  if(req.method==='POST'&&route===state.moveAfter)state.main='f'.repeat(40);
  if(state.delay)await new Promise(r=>setTimeout(r,state.delay));
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
 }catch{res.writeHead(500);res.end('{}');}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 return {root,legacy,base,sha,catalog,snapshot,state,writes,requests,pulls,refs,origin:`http://127.0.0.1:${server.address().port}`};
}
const nativeFetch=globalThis.fetch;
export async function makeLoop(f,options={}){
 globalThis.fetch=(url,init={})=>{const u=new URL(url);if(u.origin!=='https://api.github.com')throw Error('EXTERNAL_NETWORK_FORBIDDEN');
  const headers={...init.headers};delete headers.Authorization;return nativeFetch(f.origin+u.pathname+u.search,{...init,headers});};
 const remote=createPublisherTransport({token:'INERT_FIXTURE_ONLY',timeoutMs:options.timeoutMs??1000});
 const reader=createGitHubReader({token:'INERT_FIXTURE_ONLY',timeoutMs:options.timeoutMs??1000});
 const config={root:f.root,legacyStateDir:f.legacy,catalog:f.catalog,fetchSnapshot:async()=>structuredClone(f.snapshot),remote,reader,
  clock:()=>options.now?.value??1000000,timeoutMs:options.timeoutMs??1000,
  authorize:async request=>({approved:true,request,automaticCiApproved:true,automaticReviewApproved:true,operationId:'op-'+request.taskId,expiresAt:999999999}),
  runChecks:async e=>{
   const file=path.join(f.root,'scratchpads',e.taskId,target);
   execFileSync('/usr/bin/python3',['-I','-S','-c','import ast,pathlib,sys; t=ast.parse(pathlib.Path(sys.argv[1]).read_text()); assert len(t.body)==1 and isinstance(t.body[0],ast.Assign) and isinstance(t.body[0].value,ast.Constant) and t.body[0].value.value in (2,3)',file],{timeout:1000});
   return {...e,status:'PASS'};},
  // Synthetic independent-review evidence for protocol acceptance, NOT a real CodeRabbit review.
  independentReview:async e=>({...e,status:'PASS',independent:true,evidenceId:'fixture-separate-review'}),
  ciPolicies:[{name:'validate',workflowId:10},{name:'release_governance',workflowId:20}],...options};
 delete config.now;
 return createPublicationLoop(config);
}
