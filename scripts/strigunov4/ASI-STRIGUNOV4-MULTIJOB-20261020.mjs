// ASI Strigunov 4: verified multi-job roadmap dispatcher, source-only.
// The engine returns decisions. It never merges, deploys, executes shell,
// changes Github projects, makes provider calls, or treats issue text as orders.
export const RELEASE='STRIGUNOV4-READY-FOR-DEMO';
const SHA=/^[0-9a-f]{40}$/;
const stageId=n=>'S4-G'+n;
const safe=(x,msg)=>{if(!x)throw Error(msg);};
const work=Object.freeze([
  {id:'g1-pr509-reload-preflight',stage:'S4-G1',kind:'review-pr',pr:509,head:'5ba61e734a1f9a56cd807eee91b4e217bf6ee040'},
  {id:'g1-pr508-runtime-pins',stage:'S4-G1',kind:'review-pr',pr:508,head:'8ac8e8ac11e39ac070ccc058218e3b73190cb43f'},
  {id:'g1-pr520-receipt-test',stage:'S4-G1',kind:'review-pr',pr:520,head:'6693312b0a94b8afcee3a34907055ce301a5fb3e',optional:true},
  {id:'g1-unit-apply-source',stage:'S4-G1',kind:'prepare-source',
    paths:['scripts/strigunov4/protected_c4_unit_apply.py',
           '.github/workflows/strigunov4-c4-unit-apply.yml',
           'scripts/strigunov4/test_protected_c4_unit_apply.py'],
    dependsOn:['g1-pr509-reload-preflight']},
  {id:'g1-physical-repair',stage:'S4-G1',kind:'physical-gate',needs:'Exact owner authorization + staging approval + backup + safe daemon-reload'},
  {id:'g2-operator-login',stage:'S4-G2',kind:'physical-gate',needs:'Effective operator allowlists, 7 no-send flags and verified human login'},
  {id:'g3-isolated-fixtures',stage:'S4-G3',kind:'physical-gate',needs:'Historical root census, unknown write held, non-overlapping synthetic IDs'},
  {id:'g4-booking-cycle',stage:'S4-G4',kind:'physical-gate',needs:'One synthetic intake, dedup, CRM, cleaning, linen, supplies and readiness'},
  {id:'g5-operator-ui-egress',stage:'S4-G5',kind:'physical-gate',needs:'Human UI, cross-account denials, side-effect-free reads, independent no-send witness'},
  {id:'g6-acceptance',stage:'S4-G6',kind:'physical-gate',needs:'Independent physical acceptance and explicit owner READY_FOR_DEMO'}
]);
export const WORK_ORDERS=work;
export function verifyRelease(contract){
  safe(contract?.schemaVersion==='asi.demo-release.v1'&&contract.releaseId===RELEASE,
    'RELEASE_NOT_TRUSTED');
  safe(contract.state==='FROZEN_ON_OWNER_MERGE','RELEASE_NOT_FROZEN');
  safe(Array.isArray(contract.stages)&&contract.stages.length===6,'RELEASE_STAGE_COUNT');
  let active=6;
  for(let i=0;i<6;i++){
    const s=contract.stages[i];
    safe(s?.id===stageId(i+1)&&['ACCEPTED','IN_PROGRESS','NOT_STARTED'].includes(s.status),
      'RELEASE_STAGE_SCHEMA');
    if(active===6&&s.status!=='ACCEPTED')active=i;
    if(active!==6&&i>active)safe(s.status==='NOT_STARTED','RELEASE_SKIP_STAGE');
  }
  if(active<6)safe(contract.stages[active].status==='IN_PROGRESS',
    'RELEASE_ACTIVE_NOT_STARTED');
  return active;
}
export function validateWorkOrders(orders,contract){
  safe(Array.isArray(orders)&&orders.length>=6&&orders.length<30,'WORK_ORDER_COUNT');
  const names=new Set(), last=new Map();
  for(const o of orders){
    safe(o&&typeof o.id==='string'&&/^[a-z0-9-]{6,64}$/.test(o.id)&&!names.has(o.id),
      'WORK_ORDER_ID');names.add(o.id);
    safe(/^S4-G[1-6]$/.test(o.stage),'WORK_ORDER_STAGE');
    const st=contract.stages[Number(o.stage.slice(-1))-1];
    safe(st?.id===o.stage,'WORK_ORDER_STAGE_UNKNOWN');
    safe(['review-pr','prepare-source','physical-gate'].includes(o.kind),'WORK_ORDER_KIND');
    if(o.kind==='review-pr'){
      safe(Number.isSafeInteger(o.pr)&&o.pr>0&&SHA.test(o.head),'PR_PIN_REQUIRED');
      safe(!last.has(o.pr),'DUPLICATE_PR_TICKET');last.set(o.pr,o.id);
    }
    if(o.kind==='prepare-source'){
      const permitted=new Set([...(st.files||[]),...(st.plannedFiles||[])]);
      safe(Array.isArray(o.paths)&&o.paths.length>0&&o.paths.length<=3 &&
       o.paths.every(p=>typeof p==='string'&&permitted.has(p)) &&
       new Set(o.paths).size===o.paths.length,'SOURCE_PATH_NOT_IN_CONTRACT');
    }
  }
  for(const o of orders){
    safe(!o.dependsOn||Array.isArray(o.dependsOn)&&o.dependsOn.every(d=>names.has(d)&&d!==o.id),
      'WORK_DEPENDENCY_INVALID');
  }
  return true;
}
function reviewState(ticket,pr,check,review){
  if(!pr)return {status:'WAIT_PR_READ',reason:'PR_NOT_READ'};
  if(pr.number!==ticket.pr||!SHA.test(pr.head)||pr.head!==ticket.head)
    return {status:'BLOCKED',reason:'EXACT_PR_SHA_CHANGED'};
  if(pr.merged){
    if(pr.state!=='closed')return {status:'BLOCKED',reason:'MERGED_STATE_INCONSISTENT'};
    return {status:'MERGED',reason:'PR_MERGED'};
  }
  if(pr.state==='closed')return {status:'BLOCKED',reason:'CLOSED_UNMERGED'};
  if(pr.state!=='open')return {status:'BLOCKED',reason:'PR_STATE_UNTRUSTED'};
  if(check?.head!==ticket.head||check.validate!=='success'||check.release_governance!=='success')
    return {status:'WAIT_CI',reason:'CURRENT_HEAD_CHECKS_NOT_PROVEN'};
  if(review?.head!==ticket.head||review.completed!==true||review.actionable!==false)
    return {status:'WAIT_REVIEW',reason:'EXACT_HEAD_REVIEW_NOT_PROVEN'};
  return {status:'WAIT_OWNER_MERGE',reason:'REVIEWED_NOT_MERGED',pr:ticket.pr,head:ticket.head};
}
function sourceState(ticket,record,prstates,projectGate){
  if(record?.publishedPr){
    if(!Number.isInteger(record.publishedPr)||!SHA.test(record.head))
      return {status:'BLOCKED',reason:'EXISTING_JOB_LEDGER_UNTRUSTED'};
    return {status:'EXISTING_PR',reason:'SOURCE_ALREADY_PUBLISHED',pr:record.publishedPr,head:record.head};
  }
  if(record?.status==='UNKNOWN'||record?.status==='RUNNING'||record?.status==='FAILED_LOCKED')
    return {status:'BLOCKED',reason:'JOB_LEDGER_RECONCILIATION'};
  if(ticket.dependsOn?.some(id=>!['MERGED','WAIT_OWNER_MERGE'].includes(prstates[id]?.status)))
    return {status:'WAIT_DEPENDENCY',reason:'SOURCE_REVIEW_DEPENDENCY'};
  if(projectGate!=='PREPARATION_ONLY')
    return {status:'WAIT_PROJECT',reason:'PROJECT_SOURCE_GATE_NOT_GRANTED'};
  return {status:'SOURCE_PREPARATION_READY',reason:'PINNED_PATHS_ONLY',paths:ticket.paths};
}
export function decideQueue(snapshot){
  const {contract,issues,prs={},checks={},reviews={},ledger={},project={}}=snapshot||{};
  const index=verifyRelease(contract);validateWorkOrders(work,contract);
  if(index===6)return {release:RELEASE,stage:null,decision:'AWAIT_FINAL_OWNER_ACCEPTANCE',
    jobs:[],actions:[],stop:'No subsequent release scope authorized'};
  const stage=stageId(index+1),issueNum=511+index,issue=issues?.[issueNum];
  safe(issue?.number===issueNum&&issue.state==='open'&&Array.isArray(issue.labels),
    'ACTIVE_ISSUE_UNVERIFIED');
  const candidates=work.filter(x=>x.stage===stage),decisions=[],statuses={};
  const sourceEnabled=issue.labels.includes('agent-source-ready')&&
    !issue.labels.includes('agent-intake-blocked');
  for(const ticket of candidates){
    let r;
    if(ticket.kind==='review-pr')r=reviewState(ticket,prs[ticket.pr],checks[ticket.pr],reviews[ticket.pr]);
    else if(ticket.kind==='prepare-source')r=sourceEnabled?
      sourceState(ticket,ledger[ticket.id],statuses,project[issueNum]):
      {status:'WAIT_INTAKE',reason:'ISSUE_NOT_ADMITTED'};
    else r={status:'WAIT_PROTECTED_APPROVAL',reason:ticket.needs};
    statuses[ticket.id]=r;decisions.push({job:ticket.id,kind:ticket.kind,optional:!!ticket.optional,...r});
  }
  // The dispatcher does NOT grant write permissions. SOURCE_PREPARATION_READY
  // is advisory; execution requires separate trusted work-order admission.
  const actions=decisions.filter(x=>['SOURCE_PREPARATION_READY','WAIT_CI',
    'WAIT_REVIEW','WAIT_PR_READ','WAIT_OWNER_MERGE'].includes(x.status));
  return {release:RELEASE,stage,issue:issueNum,decision:
    decisions.some(x=>x.status==='BLOCKED')?'BLOCKED_NEEDS_RECONCILIATION':
    actions.some(x=>x.status==='SOURCE_PREPARATION_READY')?'SOURCE_PLAN_AVAILABLE':
    actions.some(x=>x.status==='WAIT_OWNER_MERGE')?'OWNER_DECISION_REQUIRED':
    'MONITOR_OR_WAIT',jobs:decisions,actions,stop:
    decisions.filter(x=>x.kind==='physical-gate').map(x=>x.reason).join('; ')};
}
