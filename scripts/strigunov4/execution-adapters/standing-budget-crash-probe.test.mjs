import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {initializeState,existingState,inspectStandingTransaction} from './state.mjs';
import {createStandingPublisherBudget} from './standing-budget.mjs';

const thisFile=fileURLToPath(import.meta.url);
const at=1793260000000, sha40='c'.repeat(40), hex64='b'.repeat(64);
const h=s=>createHash('sha256').update(s).digest('hex');
const task={id:'source-task',sha:sha40,repo:'ASI-integration/asi-landing',stage:'S4-G2',pr:null,branch:'source-task'};
const envelope={schema:'asi.release-envelope.proposal.v1',repo:task.repo,environment:'beget-staging',
  target:'pqukibofpo',action:'source',envelopeDigest:hex64,securityDigest:'d'.repeat(64),
  policyDigest:'e'.repeat(64),notBefore:at-1000,expiresAt:at+100000,
  maxOperations:3,maxRequests:3,maxWrites:2,paidApiUsd:0};
function effect(id){const method='POST',route='git/commits',payloadSha256=h(JSON.stringify({id}));
  return {effectId:id,taskId:task.id,taskSha:task.sha,headSha:task.sha,kind:'create-commit',
    method,route,payloadSha256,requestSha256:h(JSON.stringify({method,route,payloadSha256})),
    envelopeDigest:hex64,repo:task.repo,environment:'beget-staging',target:'pqukibofpo',action:'source'};}
const root=process.argv[2] || await fs.mkdtemp(path.join(os.tmpdir(),'asi-budget-lease-proof-'));
const role=process.env.PROBE_ROLE;
if(role==='holder'){
  const store=await existingState(root);let ledgerRef;
  await store.execute('github-publisher',async ({ledger,transaction})=>{
    ledgerRef=ledger;
    const lease=inspectStandingTransaction(transaction);
    assert.equal(lease.phase,'admission');
    return {...task};
  },{async verifyTask(t,{transaction}){const lease=inspectStandingTransaction(transaction);
    assert.equal(lease.taskId,t.id);return {verified:true};}},async ({transaction})=>{
    const lease=inspectStandingTransaction(transaction,{write:true,taskId:task.id,taskSha:task.sha});
    assert.equal(lease.ledger,ledgerRef);
    const budget=createStandingPublisherBudget({store,ledger:ledgerRef,transaction,clock:()=>at});
    const result=await budget.reserve({envelope,effect:effect('first')});
    process.stdout.write('HOLDER_READY:'+JSON.stringify({phase:lease.phase,budget:result})+'\n');
    await new Promise(()=>{setInterval(()=>{},1000);});
  });
}else if(role==='contender'){
  const store=await existingState(root);
  const result=await store.execute('github-publisher',()=>{throw Error('CONCURRENT_ENTRY');},
    {},()=>{throw Error('UNEXPECTED_EFFECT');});
  process.stdout.write(JSON.stringify(result)+'\n');
}else if(role==='orphan'){
  const store=await existingState(root);
  const ledger=JSON.parse(await fs.readFile(store.file('autopilot-ledger.json'),'utf8'));
  let result;
  try{
    const budget=createStandingPublisherBudget({store,ledger,clock:()=>at});
    result=await budget.reserve({envelope,effect:effect('second')});
  }catch(e){result={error:String(e?.message||e)};}
  process.stdout.write(JSON.stringify(result)+'\n');
}else{
  function run(role,root){
    return new Promise((resolve,reject)=>{
      const cp=spawn(process.execPath,[thisFile,root],{env:{...process.env,PROBE_ROLE:role},stdio:['ignore','pipe','pipe']});
      let out='',err='';cp.stdout.on('data',x=>out+=x);cp.stderr.on('data',x=>err+=x);
      cp.on('error',reject);cp.on('exit',(code,signal)=>code===0?resolve(JSON.parse(out.trim())):reject(Error(role+': '+code+'/'+signal+' '+err+' '+out)));
    });
  }
  test('real native lock across processes and SIGKILL; orphan adapter regression',async()=>{
    assert.equal(process.platform,'linux');
    const store=await initializeState(root);
    const holder=spawn(process.execPath,[thisFile,root],{env:{...process.env,PROBE_ROLE:'holder'},stdio:['ignore','pipe','pipe']});
    let err='',buff='';holder.stderr.on('data',d=>err+=d);
    try{
      const ready=await new Promise((resolve,reject)=>{
        const tm=setTimeout(()=>reject(Error('holder timed out '+err+' '+buff)),12000);
        holder.stdout.on('data',d=>{buff+=d.toString();const match=buff.match(/HOLDER_READY:(\{[^\n]+\})/);
          if(match){clearTimeout(tm);resolve(JSON.parse(match[1]));}});
        holder.on('exit',(code,signal)=>{clearTimeout(tm);reject(Error('holder premature exit '+code+'/'+signal+' '+err));});
      });
      assert.equal(ready.phase,'started');
      assert.equal(ready.budget.status,'RESERVED');
      const first=JSON.parse(await fs.readFile(store.file('autopilot-ledger.json'),'utf8'));
      assert.equal(first.mode,'FAILED_LOCKED');
      assert.equal(first.reason,'IN_FLIGHT_OR_CRASHED');
      assert.equal(first.jobs[task.id].mode,'STARTED');
      assert.equal(first.standingDelegationBudget.envelopes[hex64].claims.length,1);
      const competing=await run('contender',root);
      assert.equal(competing.mode,'BLOCKED');
      holder.kill('SIGKILL');
      await new Promise(resolve=>holder.once('exit',resolve));
      assert((await fs.stat(store.file('execution.lock'))).isDirectory());
      const restarted=await run('contender',root);
      assert.equal(restarted.mode,'BLOCKED');
      const afterCrash=JSON.parse(await fs.readFile(store.file('autopilot-ledger.json'),'utf8'));
      assert.equal(afterCrash.standingDelegationBudget.envelopes[hex64].claims.length,1);
      assert.throws(()=>inspectStandingTransaction({}),/STANDING_TRANSACTION_INVALID/);
      const orphan=await run('orphan',root);
      // The default regression MUST enforce native lease ownership. Historical
      // exploit reproduction belongs in a separate pre-fix checkout; forgetting
      // an environment switch must not make the unsafe outcome an expected PASS.
      assert.notEqual(orphan.status,'RESERVED','orphan may never reserve without native lease');
      assert.match(orphan.error||orphan.reason||'',/STANDING_TRANSACTION_INVALID|BUDGET_NATIVE/);
      const final=JSON.parse(await fs.readFile(store.file('autopilot-ledger.json'),'utf8'));
      assert.equal(final.standingDelegationBudget.envelopes[hex64].claims.length,1);
      console.log('PROOF:'+JSON.stringify({nativeCompeting:competing.mode,afterSigkill:restarted.mode,
        orphanReserve:orphan.status||orphan.error,claimsAfter:final.standingDelegationBudget.envelopes[hex64].claims.length,
        baselineDefect:false}));
    }finally{if(holder.exitCode===null&&holder.signalCode===null){holder.kill('SIGKILL');await new Promise(resolve=>holder.once('exit',resolve));}
      await fs.rm(root,{recursive:true,force:true});}
  });
  test('native admission, preflight, started write, postflight share one durable journal',async()=>{
    const phaseRoot=root+'-phases';
    await fs.mkdir(phaseRoot,{mode:0o700});
    const store=await initializeState(phaseRoot);
    const cap={...envelope,maxOperations:4,maxRequests:4,maxWrites:2};
    let budget,verifyCount=0;
    const read=(id,taskId,taskSha)=>{
      const method='GET',route='branches/main',payloadSha256=h('');
      return {effectId:id,taskId,taskSha,headSha:taskSha,kind:'github-read',
        method,route,payloadSha256,
        requestSha256:h(JSON.stringify({method,route,payloadSha256})),
        envelopeDigest:hex64,repo:task.repo,environment:'beget-staging',
        target:'pqukibofpo',action:'source'};
    };
    try{
      const result=await store.execute('github-publisher',
        async ({ledger,transaction})=>{
          const lease=inspectStandingTransaction(transaction);
          assert.equal(lease.phase,'admission');
          budget=createStandingPublisherBudget({store,ledger,transaction,
            admissionBaseSha:sha40,clock:()=>at});
          const admissionWrongHead=read('admission-head-spoof','admission-'+lease.transactionId,sha40);
          admissionWrongHead.headSha='f'.repeat(40);
          const wrongAdmission=await budget.reserve({envelope:cap,effect:admissionWrongHead});
          console.log('ADMISSION_HEAD_SPOOF_RESULT:'+JSON.stringify(wrongAdmission));
          assert.equal(wrongAdmission.reason,'BUDGET_NATIVE_LEASE_MISMATCH');
          const a=await budget.reserve({envelope:cap,
            effect:read('snapshot','admission-'+lease.transactionId,sha40)});
          assert.equal(a.status,'RESERVED');
          return {...task};
        },{async verifyTask(t,{transaction}){
          const lease=inspectStandingTransaction(transaction);
          verifyCount++;
          assert.equal(lease.taskId,t.id);
          assert.equal(lease.phase,verifyCount===1?'preflight':'postflight');
          const wrong=read('wrong','wrong-task',sha40);
          assert.equal((await budget.reserve({envelope:cap,effect:wrong})).reason,
            'BUDGET_NATIVE_LEASE_MISMATCH');
          const original=read('verify-'+verifyCount,t.id,t.sha);
          if(verifyCount===2)original.headSha='a'.repeat(40); // newer candidate postflight
          const promise=budget.reserve({envelope:cap,effect:original});
          original.taskId='altered-after-call';original.taskSha='d'.repeat(40);
          original.method='POST';original.route='git/commits';
          assert.equal((await promise).status,'RESERVED');
          return {verified:true};
        }},async ({transaction})=>{
          const lease=inspectStandingTransaction(transaction,{write:true,taskId:task.id,taskSha:task.sha});
          assert.equal(lease.phase,'started');
          const newCandidateWrite={...effect('publish'),headSha:'f'.repeat(40)};
          assert.equal((await budget.reserve({envelope:cap,effect:newCandidateWrite})).status,'RESERVED');
          return {status:'WAITING',reason:'SOURCE_ONLY_NO_REMOTE_EFFECT'};
        });
      assert.equal(result.mode,'WAITING');
      assert.equal(verifyCount,2);
      const committed=JSON.parse(await fs.readFile(store.file('autopilot-ledger.json'),'utf8'));
      assert.equal(committed.mode,'IDLE');
      const child=committed.standingDelegationBudget.envelopes[hex64];
      assert.deepEqual([child.operations,child.requests,child.writes,child.claims.length],[4,4,1,4]);
      assert.deepEqual(child.claims.map(c=>c.effectId),['snapshot','verify-1','publish','verify-2']);
      assert.deepEqual(child.claims.map(c=>c.taskId).slice(1),[task.id,task.id,task.id]);
      assert.equal(child.claims[1].method,'GET');
      assert.equal(child.claims[3].method,'GET');
      console.log('PHASE_PROOF:'+JSON.stringify({mode:committed.mode,
        requests:child.requests,writes:child.writes,phases:['admission','preflight','started','postflight'],
        wrongTaskDenied:true,mutatedInputIgnored:true}));
    }finally{await fs.rm(phaseRoot,{recursive:true,force:true});}
  });

test('native owner-lock path replacement refuses a second claim, preserving the journal',async()=>{
  // Isolated same-UID directory replacement; not a live operation or a claim
  // of protection against every filesystem adversary. The original lease
  // remains held while the pathname points to a different directory inode.
  const swapRoot=root+'-swap';
  await fs.mkdir(swapRoot,{mode:0o700});
  const store=await initializeState(swapRoot);
  let ledgerRef;
  try {
    const result=await store.execute('github-publisher',
      async({ledger})=>{ledgerRef=ledger;return {...task};},
      {async verifyTask(){return {verified:true};}},
      async({transaction})=>{
        const lease=inspectStandingTransaction(transaction,{write:true});
        assert.equal(lease.phase,'started');
        const budget=createStandingPublisherBudget({store,ledger:ledgerRef,transaction,clock:()=>at});
        const original=store.file('execution.lock');
        const moved=original+'-old-lease';
        await fs.rename(original,moved);
        await fs.mkdir(original,{mode:0o700});
        let attempted;
        try{
          attempted=await budget.reserve({envelope,effect:effect('path-replaced')});
          console.log('SWAP_RESERVATION:'+JSON.stringify(attempted));
          assert.equal(attempted.reason,'BUDGET_NATIVE_LEASE_MISMATCH',
            'a new inode at the lock pathname cannot authorize the old lease');
          assert.equal(ledgerRef.standingDelegationBudget?.envelopes?.[hex64],undefined);
          const onDisk=JSON.parse(await fs.readFile(store.file('autopilot-ledger.json'),'utf8'));
          assert.equal(onDisk.standingDelegationBudget?.envelopes?.[hex64],undefined);
        }finally{
          await fs.rmdir(original);
          await fs.rename(moved,original);
        }
        return {status:'WAITING',reason:'SOURCE_ONLY_LOCK_SWAP_TEST'};
      });
    assert.equal(result.mode,'WAITING');
  }finally{
    await fs.rm(swapRoot,{recursive:true,force:true});
  }
});

}
