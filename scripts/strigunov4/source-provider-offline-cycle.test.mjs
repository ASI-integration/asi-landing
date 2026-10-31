import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {createPinnedSourceReader} from './source-git-context.mjs';
import {createResponsesCodeProducer} from './source-responses-provider.mjs';
import {proposeSourceWork} from './source-work-intake.mjs';
import {compileSourcePublisherHandoff} from './source-publisher-handoff.mjs';
import {initializeState} from './execution-adapters/state.mjs';
import {prepareDelta} from './execution-adapters/change-preparer.mjs';

const SOURCE='scripts/strigunov4/test_beget_g2_witness_identity_v1.py';
const NEW='def inspect():\n    return True\n';
const git=(cwd,args)=>execFileSync('/usr/bin/git',args,{cwd,encoding:'utf8',
 env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',GIT_CONFIG_NOSYSTEM:'1',
   GIT_CONFIG_GLOBAL:'/dev/null'}});
test('offline full candidate -> actual existing Git preparer and syntax check; no remote effects',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'asi-source-offline-cycle-'));
 await fs.chmod(root,0o700);
 const seed=path.join(root,'seed');await fs.mkdir(seed,{mode:0o700});
 try {
   git(seed,['init','-q']);git(seed,['config','user.name','ASI fixture']);
   git(seed,['config','user.email','fixture@example.invalid']);
   await fs.mkdir(path.join(seed,'scripts','strigunov4'),{recursive:true});
   await fs.writeFile(path.join(seed,'scripts','strigunov4','README.txt'),'existing\n');
   git(seed,['add','.']);git(seed,['commit','-qm','baseline']);
   const baseSha=git(seed,['rev-parse','HEAD']).trim();
   const admitted={id:'beget-g2-witness-identity-v1',
     laneId:'engine',repo:'ASI-integration/asi-landing',
     branch:'asi/beget-one-engine-20261028',baseSha,stage:'S4-G2',
     kind:'source-proposal',objective:'Add a harmless Python inspect() fixture for this exact authorized file.',
     files:[{path:SOURCE,beforeSha256:null}]};
   const store=await initializeState(root);
   for(const sub of ['readclone','scratchpads/'+admitted.id]){
     const cwd=path.join(root,sub);
     git(root,['clone','-q','--no-hardlinks',seed,cwd]);
     git(cwd,['checkout','-q','--detach',baseSha]);
     await fs.chmod(cwd,0o700);
   }
   let providerCalls=0,authorizationCalls=0;
   const getContext=createPinnedSourceReader({
     checkout:path.join(root,'readclone'),admittedTasks:[admitted]});
   const produce=createResponsesCodeProducer({
     model:'gpt-6-astra',apiKey:'sk-mock-never-external',
     getContext,
     admitRequest:async req=>{
       authorizationCalls++;
       return {authorized:true,taskId:req.taskId,baseSha:req.baseSha,
         model:req.model,maxOutputTokens:req.maxOutputTokens,pathDigest:req.pathDigest,operationId:'fixture-no-real-spend'};
     },
     transport:async (url,request)=>{
       providerCalls++;
       assert.equal(url,'https://api.openai.com/v1/responses');
       assert.equal(request.redirect,'error');
       const body=JSON.parse(request.body);
       assert.equal(body.store,false);
       assert.deepEqual(body.tools,[]);
       const task=JSON.parse(body.input[0].content[0].text);
       assert.equal(task.files[0].path,SOURCE);
       assert.equal(task.files[0].content,'');
       assert.equal(task.objective,admitted.objective);
       return new Response(JSON.stringify({
         status:'completed',output:[{type:'message',role:'assistant',status:'completed',
           content:[{type:'output_text',text:JSON.stringify({status:'PROPOSED',
             changes:[{path:SOURCE,content:NEW}]})}]}]
       }),{status:200,headers:{'content-type':'application/json'}});
     }
   });
   const proposal=await proposeSourceWork({task:admitted,admittedTasks:[admitted],produce});
   assert.equal(proposal.status,'PROPOSAL_PREPARED');
   const handoff=compileSourcePublisherHandoff({
     task:admitted,admittedTasks:[admitted],proposal});
   assert.equal(handoff.status,'SOURCE_PREPARER_CANDIDATE');
   assert.equal(handoff.authorized,false);
   // Existing G2 preparer only. This test does NOT alter its two-witness gate.
   const publisherTask={...handoff.task,
     branch:'asi/engine-task/'+admitted.id};
   const prepared=await prepareDelta(store,publisherTask,{
     admission:{taskId:admitted.id,head:baseSha,stage:'S4-G2',
       mode:'ISOLATED_PREPARE_ONLY',paths:[SOURCE]},
     changes:publisherTask.changes
   });
   assert.equal(prepared.status,'PASS');
   assert.equal(prepared.commitCreated,false);
   assert.equal(prepared.files.length,1);
   assert.equal(await fs.readFile(path.join(root,'scratchpads',admitted.id,SOURCE),'utf8'),NEW);
   assert.equal(providerCalls,1);
   assert.equal(authorizationCalls,1);
   assert.equal(git(path.join(root,'scratchpads',admitted.id),['rev-parse','HEAD']).trim(),baseSha);
 }finally{await fs.rm(root,{recursive:true,force:true})}
});
