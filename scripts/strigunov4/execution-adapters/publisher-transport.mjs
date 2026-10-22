// Host-owned capability only. Import is inert. No arbitrary REST writes or retries.
import {must,sha} from './state.mjs';
export const REPOSITORY='ASI-integration/asi-landing';
export const branchAllowed=b=>typeof b==='string'&&/^asi\/engine-task\/[a-z0-9][a-z0-9-]{0,70}$/.test(b);
export function draftBody(job,evidence){
  must(/^[a-z0-9-]{1,96}$/.test(job)&&sha(evidence?.baseSha)&&sha(evidence?.head)&&/^[a-f0-9]{64}$/.test(evidence?.deltaSha256),'PR_EVIDENCE_REQUIRED');
  return `Release-Stage: S4-G1\nRelease-Mode: implementation\n
## Результат
Approved source task ${job}. Draft publication only; physical acceptance is not claimed.
## Scope
Baseline SHA: ${evidence.baseSha}
Candidate SHA: ${evidence.head}
Delta SHA256: ${evidence.deltaSha256}
Only host-admitted existing files. No deployment or merge.
## Product contract
No product scope or authority expansion; host admission required.
## Autonomy и риск
Уровень: yellow. Unknown publication outcomes freeze the queue.
## Изменённые файлы
Exact admitted diff verified through GitHub tree and PR file readback.
## Проверки
Local checks and independent delta review passed. GitHub CI and exact-HEAD CodeRabbit remain pending verification.
## Data, migration и external side effects
Git objects, one task branch and one Draft PR only. No server, database, messages or payments.
## Staging / rollout / rollback
No staging or production execution. Stop admission; preserve receipts and locks. No automatic remote deletion or history rewrite.
## Blockers и handoff
Wait for exact-HEAD CI and independent review. Owner-only gates are never inferred from this text.
## Checklist
Draft; no merge; no physical G1 acceptance; G2 remains closed.\n`;
}
export async function bounded(operation,timeoutMs=10000){
  must(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=30000,'DEADLINE_REQUIRED');
  const controller=new AbortController();let timer;
  const expired=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('PORT_TIMEOUT'));},timeoutMs);});
  try{return await Promise.race([Promise.resolve().then(()=>operation(controller.signal)),expired]);}
  finally{clearTimeout(timer);}
}
/** A timed-out transport is permanently poisoned, including abort-ignoring fetches.
 * Hosts must not construct a replacement to replay an uncertain mutation.
 */
export function createPublisherTransport({token,timeoutMs=10000}={}){
  must(typeof token==='string'&&token.trim().length>0,'HOST_TOKEN_REQUIRED');
  let poisoned=false,busy=false;
  async function request(method,route,body){
    must(!poisoned&&!busy,'TRANSPORT_LOCKED');busy=true;
    try{return await bounded(async signal=>{
      const response=await fetch(`https://api.github.com/repos/${REPOSITORY}/${route}`,{
        method,redirect:'error',signal,headers:{Authorization:`Bearer ${token}`,
          Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',
          ...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
      must(response.ok,'REMOTE_RESULT_UNKNOWN');
      const reader=response.body.getReader();const chunks=[];let bytes=0;
      try{for(;;){const x=await reader.read();if(x.done)break;bytes+=x.value.length;
        must(bytes<=4_000_000,'REMOTE_RESPONSE_LIMIT');chunks.push(x.value);}}
      finally{await reader.cancel();}
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    },timeoutMs);}catch{poisoned=true;throw Error('REMOTE_RESULT_UNKNOWN');}
    finally{busy=false;}
  }
  return Object.freeze({
    get(route){
      must(typeof route==='string'&&(/^(branches\/main|git\/commits\/[a-f0-9]{40}|git\/trees\/[a-f0-9]{40}\?recursive=1)$/.test(route)||
        /^git\/matching-refs\/heads\/asi\/engine-task\/[a-z0-9-]+$/.test(route)||
        /^pulls\?state=all&head=ASI-integration:asi%2Fengine-task%2F[a-z0-9-]+&per_page=100$/.test(route)||
        /^pulls\/[1-9][0-9]*(?:\/files\?per_page=100)?$/.test(route)),'READ_ROUTE_DENIED');
      return request('GET',route);
    },
    createTree(base,entries){must(sha(base)&&Array.isArray(entries)&&entries.length>0&&entries.length<=3&&
      entries.every(e=>e.type==='blob'&&['100644','100755'].includes(e.mode)&&typeof e.content==='string'&&
        /^[a-zA-Z0-9_/-]+\.(py|mjs|js|json)$/.test(e.path)&&!e.path.split('/').some(p=>p==='..')&&!e.path.startsWith('/')),'TREE_DENIED');
      return request('POST','git/trees',{base_tree:base,tree:entries.map(({path,mode,type,content})=>({path,mode,type,content}))});},
    createCommit(parent,tree,job){must(sha(parent)&&sha(tree)&&/^[a-z0-9-]{1,96}$/.test(job),'COMMIT_DENIED');
      return request('POST','git/commits',{parents:[parent],tree,message:`ASI approved source task ${job}`});},
    createBranch(branch,head){must(branchAllowed(branch)&&sha(head),'BRANCH_DENIED');
      return request('POST','git/refs',{ref:`refs/heads/${branch}`,sha:head});},
    createDraft(branch,job,evidence){must(branchAllowed(branch)&&/^[a-z0-9-]{1,96}$/.test(job),'PR_DENIED');
      return request('POST','pulls',{head:branch,base:'main',draft:true,maintainer_can_modify:false,
        title:`ASI source task ${job}`,body:draftBody(job,evidence)});},
  });
}
