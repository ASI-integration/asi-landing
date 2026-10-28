import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {atomicJson,digest,must,regular,sha} from './state.mjs';
import {prepareDelta,normalizeProposedContent} from './change-preparer.mjs';
import {inspectCI,validateCiPolicy} from './ci-reader.mjs';
import {inspectCodeRabbit} from './coderabbit-analyzer.mjs';
import {bounded,branchAllowed,REPOSITORY,draftBody} from './publisher-transport.mjs';

const hashBlob=content=>createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest('hex');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const freeze=x=>{if(x&&typeof x==='object'){Object.values(x).forEach(freeze);Object.freeze(x);}return x;};
export const bindTask=t=>digest(JSON.stringify(t));
async function load(file){let value;try{must((await regular(file)).size<500000,'PUBLICATION_JOURNAL_SIZE');value=JSON.parse(await fs.readFile(file,'utf8'));}
  catch(e){if(e.code==='ENOENT')return null;throw e;}
  must(value!==null&&typeof value==='object'&&!Array.isArray(value),'PUBLICATION_JOURNAL_INVALID');return value;}

/** Called ONLY inside the existing store.execute shared lock. Not a second state
 * engine: the existing ledger is the durable brake and final receipt authority.
 * This subordinate journal records remote intent/readback across WAITING ticks.
 */
export function createGitHubPublisher({store,remote,reader,authorize,runChecks,independentReview,verifyAdmission,ciPolicies,publishedReview,clock=Date.now,timeoutMs=10000}={}){
  must([authorize,runChecks,independentReview,verifyAdmission,clock].every(x=>typeof x==='function'),'HOST_PORTS_REQUIRED');
  must(ciPolicies?.some(p=>p.name==='validate')&&ciPolicies.some(p=>p.name==='release_governance'),'REQUIRED_CI_MISSING');
  const policies=freeze(structuredClone(ciPolicies));
  // Alternative host-reviewed evidence is opt-in and bound into the exact grant.
  // Existing installations retain CodeRabbit; no advisory snapshot selects a reviewer.
  must(publishedReview===undefined||typeof publishedReview.verify==='function'&&
    /^[a-f0-9]{64}$/.test(publishedReview.policySha256),'PUBLISHED_REVIEW_POLICY');
  const reviewPolicy=publishedReview&&Object.freeze({...publishedReview});
  const call=f=>bounded(f,timeoutMs);
  const evidence=f=>bounded(f,Math.min(30000,timeoutMs*3));
  return Object.freeze({async run(input,{execute=false}={}){
    must(execute===true,'PUBLISH_NOT_AUTHORIZED');
    const task=freeze(structuredClone(input));
    must(task.repo===REPOSITORY&&task.stage==='S4-G1'&&task.kind==='github-publisher'&&
      /^[a-z0-9-]{1,96}$/.test(task.id)&&sha(task.sha)&&task.pr===null&&branchAllowed(task.branch),'PUBLISH_TASK_INVALID');
    must(Array.isArray(task.changes)&&task.changes.length>0&&task.changes.length<=3&&
      new Set(task.changes.map(c=>c.path)).size===task.changes.length,'PUBLISH_DELTA_INVALID');
    validateCiPolicy({...task,baseSha:task.sha},policies);
    const binding=bindTask(task),file=store.file(`publication-${task.id}.json`);
    let record=await load(file);
    const request=freeze({taskId:task.id,taskBinding:binding,repo:task.repo,stage:task.stage,
      baseSha:task.sha,branch:task.branch,paths:task.changes.map(c=>c.path),operations:['create-tree','create-commit','create-branch','create-draft-pr'],
      ...(reviewPolicy?{reviewPolicySha256:reviewPolicy.policySha256}:{})});
    const grant=freeze(structuredClone(await call(signal=>authorize(request,{signal}))));
    must(grant?.approved===true&&equal(grant.request,request)&&grant.automaticCiApproved===true&&
      grant.automaticReviewApproved===true&&typeof grant.operationId==='string'&&/^[a-z0-9-]{1,96}$/.test(grant.operationId)&&
      Number.isSafeInteger(grant.expiresAt)&&grant.expiresAt>clock(),'PUBLICATION_CAPABILITY_DENIED');
    const assertGrant=()=>must(grant.expiresAt>clock(),'CAPABILITY_EXPIRED');
    async function main(){assertGrant();await call(signal=>verifyAdmission({signal}));const m=await call(()=>remote.get('branches/main'));
      must(m.protected===true&&m.commit?.sha===task.sha,'MAIN_CHANGED');}
    async function history(){const list=await call(()=>remote.get(`pulls?state=all&head=ASI-integration:${encodeURIComponent(task.branch)}&per_page=100`));
      must(Array.isArray(list)&&list.length<100&&list.every(p=>Number.isSafeInteger(p.number)&&p.head?.ref===task.branch&&
        p.head?.repo?.full_name===task.repo),'PR_HISTORY_UNVERIFIED');return list;}
    async function refs(){const list=await call(()=>remote.get(`git/matching-refs/heads/${task.branch}`));
      must(Array.isArray(list)&&list.length<100,'REF_HISTORY_UNVERIFIED');return list.filter(r=>r.ref===`refs/heads/${task.branch}`);}
    async function guard(expectedHead=null,expectedPr=null){
      await main();const ref=await refs(),prs=await history();
      must(expectedHead===null?ref.length===0:ref.length===1&&ref[0].object?.sha===expectedHead&&ref[0].object.type==='commit','BRANCH_CHANGED');
      must(expectedPr===null?prs.length===0:prs.length===1&&prs[0].number===expectedPr,'PR_IDENTITY_CHANGED');
      await main();
    }
    async function save(phase,fields={}){record={...record,...fields,phase};await atomicJson(file,record);}
    async function mutate(name,fn,expectedHead=null){
      await guard(expectedHead);await save('INTENT',{pending:name});assertGrant();
      return call(fn); // Unknown response leaves INTENT and outer FAILED_LOCKED, never retries.
    }
    async function verifyRemote(){
      must(record&&sha(record.head)&&Number.isSafeInteger(record.pr)&&record.pr>0,'REMOTE_RECORD_INVALID');
      await guard(record.head,record.pr);
      const p=await call(()=>remote.get(`pulls/${record.pr}`));
      must(p.number===record.pr&&p.state==='open'&&p.merged===false&&p.draft===true&&
        p.title===`ASI source task ${task.id}`&&p.body===draftBody(task.id,record)&&
        p.head?.sha===record.head&&p.head.ref===task.branch&&p.head.repo?.full_name===task.repo&&
        p.base?.sha===task.sha&&p.base.ref==='main'&&p.base.repo?.full_name===task.repo&&
        p.html_url===`https://github.com/${task.repo}/pull/${record.pr}`,'PR_READBACK_FAILED');
      const commit=await call(()=>remote.get(`git/commits/${record.head}`));
      must(commit.sha===record.head&&commit.tree?.sha===record.tree&&commit.parents?.length===1&&commit.parents[0].sha===task.sha,'COMMIT_READBACK_FAILED');
      const changed=await call(()=>remote.get(`pulls/${record.pr}/files?per_page=100`));
      must(Array.isArray(changed)&&changed.length===task.changes.length&&p.changed_files===changed.length&&
        new Set(changed.map(f=>f.filename)).size===changed.length&&changed.every(f=>f.status==='modified'&&
          task.changes.some(c=>c.path===f.filename&&f.sha===hashBlob(normalizeProposedContent(c.path,c.content)))),'PR_DIFF_READBACK_FAILED');
      await guard(record.head,record.pr);
    }
    if(record){
      must(record.version===1&&record.taskBinding===binding&&record.operationId===grant.operationId&&
        record.kind===task.kind&&['PUBLISHED_WAITING','VERIFIED'].includes(record.phase),'UNCERTAIN_OR_FOREIGN_PUBLICATION');
    }else{
      await guard();
      for(const name of await fs.readdir(path.dirname(file))){
        if(name.startsWith('publication-')&&name.endsWith('.json')&&name!==path.basename(file)){
          const other=await load(store.file(name));must(other?.operationId!==grant.operationId,'CAPABILITY_REUSE');
        }
      }
      const prepared=await prepareDelta(store,task,{admission:{taskId:task.id,head:task.sha,stage:task.stage,
        mode:'ISOLATED_PREPARE_ONLY',paths:request.paths},changes:task.changes});
      const check=await call(signal=>runChecks(freeze({taskId:task.id,baseSha:task.sha,deltaSha256:prepared.deltaSha256}),{signal}));
      must(check?.status==='PASS'&&check.deltaSha256===prepared.deltaSha256&&check.baseSha===task.sha,'LOCAL_CHECK_UNVERIFIED');
      const review=await call(signal=>independentReview(freeze({taskId:task.id,baseSha:task.sha,deltaSha256:prepared.deltaSha256}),{signal}));
      must(review?.status==='PASS'&&review.deltaSha256===prepared.deltaSha256&&review.baseSha===task.sha&&
        review.independent===true&&typeof review.evidenceId==='string'&&/^[a-zA-Z0-9_-]{1,96}$/.test(review.evidenceId),'INDEPENDENT_REVIEW_UNVERIFIED');
      // Check exact prepared bytes again after host tests/review. No test output or source is logged.
      for(const c of task.changes){const f=path.join(store.root,'scratchpads',task.id,c.path);await regular(f);
        must(digest(await fs.readFile(f))===digest(normalizeProposedContent(c.path,c.content)),'PREPARED_BYTES_CHANGED');}
      const parent=await call(()=>remote.get(`git/commits/${task.sha}`));
      must(parent.sha===task.sha&&sha(parent.tree?.sha),'BASE_COMMIT_INVALID');
      const before=await call(()=>remote.get(`git/trees/${parent.tree.sha}?recursive=1`));
      must(before.sha===parent.tree.sha&&before.truncated===false&&Array.isArray(before.tree)&&before.tree.length<=10000&&
        new Set(before.tree.map(e=>e.path)).size===before.tree.length,'BASE_TREE_UNVERIFIED');
      const entries=task.changes.map(c=>{const old=before.tree.find(e=>e.path===c.path);
        must(old?.type==='blob'&&['100644','100755'].includes(old.mode),'EXISTING_REGULAR_FILE_REQUIRED');
        return {path:c.path,mode:old.mode,type:'blob',content:normalizeProposedContent(c.path,c.content)};});
      record={version:1,kind:task.kind,taskBinding:binding,operationId:grant.operationId,baseSha:task.sha,
        branch:task.branch,deltaSha256:prepared.deltaSha256,reviewEvidenceId:review.evidenceId};
      const tree=await mutate('create-tree',()=>remote.createTree(parent.tree.sha,entries));
      must(sha(tree.sha),'TREE_RESULT_INVALID');
      const actual=await call(()=>remote.get(`git/trees/${tree.sha}?recursive=1`));
      must(actual.sha===tree.sha&&actual.truncated===false&&Array.isArray(actual.tree)&&actual.tree.length===before.tree.length&&
        new Set(actual.tree.map(e=>e.path)).size===actual.tree.length,'TREE_READBACK_FAILED');
      for(const old of before.tree){const now=actual.tree.find(e=>e.path===old.path),change=entries.find(e=>e.path===old.path);
        must(now&&now.mode===old.mode&&now.type===old.type,'TREE_MODE_CHANGED');
        // Parent tree identities change when a nested blob changes; compare all leaf identities.
        if(old.type!=='tree')must(now.sha===(change?hashBlob(change.content):old.sha),'TREE_OUTSIDE_SCOPE');}
      await save('TREE_CREATED',{tree:tree.sha});
      const commit=await mutate('create-commit',()=>remote.createCommit(task.sha,tree.sha,task.id));
      must(sha(commit.sha),'COMMIT_RESULT_INVALID');
      const verified=await call(()=>remote.get(`git/commits/${commit.sha}`));
      must(verified.sha===commit.sha&&verified.tree?.sha===tree.sha&&verified.parents?.length===1&&verified.parents[0].sha===task.sha,'COMMIT_READBACK_FAILED');
      await save('COMMIT_CREATED',{head:commit.sha});
      await mutate('create-branch',()=>remote.createBranch(task.branch,commit.sha));
      await guard(commit.sha);await save('BRANCH_CREATED');
      const pr=await mutate('create-draft-pr',()=>remote.createDraft(task.branch,task.id,record),commit.sha);
      must(Number.isSafeInteger(pr.number)&&pr.number>0,'PR_RESULT_INVALID');
      record.pr=pr.number;await verifyRemote();await save('PUBLISHED_WAITING',{pending:null});
    }
    await verifyRemote();
    const pin={id:task.id,repo:task.repo,stage:task.stage,sha:record.head,pr:record.pr,branch:task.branch,baseSha:task.sha};
    async function inspectReview(){
      if(!reviewPolicy)return inspectCodeRabbit(reader,pin);
      const r=await reviewPolicy.verify(freeze({...pin,deltaSha256:record.deltaSha256,policySha256:reviewPolicy.policySha256}));
      must(r&&['PASS','WAITING','FAILED'].includes(r.status)&&r.repo===pin.repo&&r.pr===pin.pr&&r.head===pin.sha&&
        r.baseSha===pin.baseSha&&r.policySha256===reviewPolicy.policySha256&&r.independent===true&&
        /^[a-f0-9]{64}$/.test(r.evidenceSha256),'PUBLISHED_REVIEW_UNVERIFIED');
      // Persist allowlisted metadata only, never raw reviewer output.
      return {status:r.status,repo:r.repo,pr:r.pr,head:r.head,baseSha:r.baseSha,policySha256:r.policySha256,
        independent:true,evidenceSha256:r.evidenceSha256};
    }
    const ci=await evidence(()=>inspectCI(reader,pin,policies));
    if(ci.status==='FAILED')return {status:'FAILED',phase:'REMOTE_CI'};
    if(ci.status!=='PASS')return {status:'WAITING',phase:'REMOTE_CI',head:record.head,pr:record.pr};
    const review=await evidence(inspectReview);
    if(review.status==='FAILED')return {status:'FAILED',phase:'REMOTE_REVIEW'};
    if(review.status!=='PASS')return {status:'WAITING',phase:'REMOTE_REVIEW',head:record.head,pr:record.pr};
    await verifyRemote();
    const freshCI=await evidence(()=>inspectCI(reader,pin,policies));
    const freshReview=await evidence(inspectReview);
    must(equal(ci,freshCI)&&equal(review,freshReview),'PROMOTION_EVIDENCE_CHANGED');
    await verifyRemote();await save('VERIFIED');
    return {status:'PASS',artifactType:'GITHUB_PR_VERIFIED',head:record.head,pr:record.pr,
      url:`https://github.com/${task.repo}/pull/${record.pr}`,baseSha:task.sha,taskBinding:binding,ci,review,physicalAcceptance:false};
  }});
}
