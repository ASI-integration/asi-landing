/** Stage-bounded source-task authorization: owner approves one immutable catalog,
 * not a new private-key signature for every ordinary work order.
 * This is a pure candidate, not a live execution or permissions port.
 * The host must fetch comments from the authenticated GitHub API; a caller-
 * supplied PR/Issue body or synthetic verified=true is never sufficient.
 */
import {createHash} from 'node:crypto';
const REPO='ASI-integration/asi-landing', OWNER_ID=207600140;
const hash=x=>createHash('sha256').update(x).digest('hex');
const sha40=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const validId=x=>typeof x==='string'&&/^[a-z0-9][a-z0-9-]{3,79}$/.test(x);
const actions=['create-tree','create-commit','create-branch','create-draft-pr'];
const require=(ok,code)=>{if(!ok)throw Error(code);};
const exactKeys=(v,n)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===[...n].sort().join('|');
const distinct=xs=>new Set(xs).size===xs.length;
const grants=new WeakMap();
export const stagePolicyHash=p=>hash(JSON.stringify(p));
export function validateStagePolicy(p,now=Date.now()){
 require(exactKeys(p,['schema','repository','stage','issue','baseSha','notBefore','expiresAt','tasks']),'STAGE_POLICY_SCHEMA');
 require(((p.schema==='asi.stage-authority.v1'&&p.stage==='S4-G1'&&p.issue===511)||
  (p.schema==='asi.stage-authority.beget.v1'&&p.stage==='S4-G2'&&p.issue===512))&&p.repository===REPO&&sha40(p.baseSha)&&
  Number.isSafeInteger(p.notBefore)&&Number.isSafeInteger(p.expiresAt)&&p.notBefore<=now&&now<p.expiresAt&&
  p.expiresAt-p.notBefore<=14*86400000,'STAGE_POLICY_SCOPE_OR_EXPIRY');
 require(Array.isArray(p.tasks)&&p.tasks.length>0&&p.tasks.length<=8,'STAGE_TASK_BOUND');
 require(distinct(p.tasks.map(t=>t.id))&&distinct(p.tasks.map(t=>t.branch))&&distinct(p.tasks.map(t=>t.workOrderId)),'STAGE_TASK_REPLAY');
 for(const t of p.tasks){
  require(exactKeys(t,['id','workOrderId','branch','baseSha','paths','operations'])&&validId(t.id)&&validId(t.workOrderId)&&
   typeof t.branch==='string'&&/^asi\/engine-task\/[a-z0-9][a-z0-9-]{3,79}$/.test(t.branch)&&
   t.baseSha===p.baseSha&&Array.isArray(t.paths)&&t.paths.length>0&&t.paths.length<=3&&distinct(t.paths)&&
   t.paths.every(x=>typeof x==='string'&&/^scripts\/strigunov4\/[a-zA-Z0-9][a-zA-Z0-9_./-]*\.py$/.test(x)&&
    !x.includes('..')&&!x.includes('//')&&!x.includes('/candidates/'))&&
   JSON.stringify(t.operations)===JSON.stringify(actions),'STAGE_TASK_SCOPE');
 }
 if(p.schema==='asi.stage-authority.beget.v1'){
  require(p.tasks.length<=2&&p.tasks.every(t=>t.id===t.workOrderId&&
    /^beget-g2-witness-(identity|races)-v1$/.test(t.id)&&t.branch==='asi/engine-task/'+t.id&&
    t.paths.length===1&&t.paths[0]==='scripts/strigunov4/test_'+t.id.replaceAll('-','_')+'.py'),'BEGET_TASK_SCOPE');
 }
 return stagePolicyHash(p);
}
/** The trusted host reader must verify the repository/issue and return the
 * authentic REST comment identities. Deleted owner comments revoke on re-read.
 */
export async function verifyOwnerStageDecision(p,{readTrustedComments,now=Date.now()}={}){
 const policyHash=validateStagePolicy(p,now);
 require(typeof readTrustedComments==='function','TRUSTED_OWNER_READER_REQUIRED');
 const comments=await readTrustedComments({repository:REPO,issue:p.issue});
 require(Array.isArray(comments)&&comments.length<=1000,'OWNER_COMMENT_SOURCE_INVALID');
 const exact=`ASI-OWNER-STAGE-APPROVE:${p.stage}:${p.issue}:`+policyHash;
 const matching=comments.filter(c=>c?.body===exact&&c.user?.id===OWNER_ID&&
  Number.isFinite(Date.parse(c.created_at))&&Date.parse(c.created_at)>=p.notBefore&&
  Date.parse(c.created_at)<=now&&c.updated_at===c.created_at);
 require(matching.length===1,'OWNER_STAGE_DECISION_NOT_VERIFIED');
 const capability=Object.freeze({});
 grants.set(capability,{policyHash,expiresAt:p.expiresAt,tasks:new Map(p.tasks.map(t=>[t.id,JSON.stringify(t)]))});
 return capability;
}
/** Checks one selected task and retained completion IDs without executing it.
 * Native Engine/GitHub permissions and crash/replay protections remain required.
 */
export function authorizeStageTask(p,capability,task,{completedIds=[],now=Date.now()}={}){
 const g=grants.get(capability);
 require(g&&validateStagePolicy(p,now)===g.policyHash&&now<g.expiresAt,'STAGE_GRANT_INVALID');
 require(Array.isArray(completedIds)&&completedIds.every(x=>typeof x==='string')&&distinct(completedIds),'RECEIPT_SET_INVALID');
 require(task&&typeof task.id==='string'&&g.tasks.get(task.id)===JSON.stringify(task),'STAGE_TASK_NOT_APPROVED');
 require(!completedIds.includes(task.id),'STAGE_TASK_ALREADY_COMPLETED');
 return Object.freeze({admitted:true,taskId:task.id,policySha256:g.policyHash,expiresAt:g.expiresAt,executionAllowed:false});
}
