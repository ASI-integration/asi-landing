/**
 * Value/intent triage for the EXISTING Dispatcher before routing reservation.
 * The model/reviewer verdict is advisory and NOT a signed execution grant.
 * This module verifies scope, benefit, acceptance and durable duplicate facts.
 */
import {createHash} from 'node:crypto';
const hash=s=>createHash('sha256').update(s).digest('hex');
const h64=/^[0-9a-f]{64}$/;
const taskId=/^[a-z][a-z0-9-]{0,79}$/;
const decisions=new Set(['ACCEPTED','DUPLICATE','ALREADY_DONE','NO_VALUE',
 'OUT_OF_SCOPE','ILL_LOGICAL','BLOCKED_DEPENDENCY','NEEDS_OWNER_DECISION']);
const failure=(status,reason,alternative='Review the goal and provide one measurable outcome.')=>
 Object.freeze({schema:'asi.task-intake-decision.v1',status,reason,alternative,
 authorized:false,executable:false,admitted:false,intentKey:null});
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
 (Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null)&&
 Reflect.ownKeys(v).every(k=>typeof k==='string'&&Object.hasOwn(Object.getOwnPropertyDescriptor(v,k),'value'));
const data=(o,keys)=>plain(o)&&Reflect.ownKeys(o).length===keys.length&&
 keys.every(k=>Object.hasOwn(o,k)&&Object.hasOwn(Object.getOwnPropertyDescriptor(o,k),'value'));
const bounded=(v,max=600)=>typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=max;
const arr=(a,max=10)=>Array.isArray(a)&&a.length<=max&&a.length>0&&
 Reflect.ownKeys(a).length===a.length+1&&a.every((v,i)=>bounded(v,350)&&
 Object.hasOwn(Object.getOwnPropertyDescriptor(a,String(i)),'value'));
const normalize=s=>s.normalize('NFKC').toLowerCase().replace(/[.,!?;:()[\]{}"«»']/g,' ')
 .replace(/\s+/g,' ').trim();
export const INTAKE_REASONS=Object.freeze([...decisions]);
export function inspectTaskIntake({product,task,goalGraph,assessment,history=[]}={}){
 try{
  if(!taskId.test(product||'')||!plain(task)||!taskId.test(task.id)||
    !Array.isArray(task.paths)||!task.paths.length||
    task.paths.some(p=>!bounded(p,350)||p.includes('..')||p.startsWith('/'))||
    !plain(goalGraph)||!h64.test(goalGraph.planHash)||
    !Array.isArray(goalGraph.nodes)||!plain(goalGraph.goal)||
    !Array.isArray(goalGraph.goal.criteria)||!goalGraph.nodes.some(n=>n.id===task.id))
    return failure('OUT_OF_SCOPE','TASK_NOT_IN_VERIFIED_GOAL_PLAN');
  const fields=['schema','taskId','goalPlanHash','decision','outcome',
    'expectedBenefit','acceptanceEvidence','reason','alternative','possibleDuplicates'];
  if(!data(assessment,fields)||assessment.schema!=='asi.task-value-assessment.v1'||
    assessment.taskId!==task.id||assessment.goalPlanHash!==goalGraph.planHash||
    !decisions.has(assessment.decision)||!bounded(assessment.reason,900)||
    !bounded(assessment.alternative,900)||!Array.isArray(assessment.possibleDuplicates)||
    assessment.possibleDuplicates.length>20||
    assessment.possibleDuplicates.some(id=>!taskId.test(id)))
    return failure('NEEDS_OWNER_DECISION','ASSESSMENT_UNVERIFIED_OR_MISMATCHED');
  if(assessment.decision!=='ACCEPTED')
    return failure(assessment.decision,assessment.reason,assessment.alternative);
  const graphNode=goalGraph.nodes.find(n=>n.id===task.id);
  if(!bounded(assessment.outcome)||!bounded(assessment.expectedBenefit)||
    normalize(assessment.outcome).length<8||normalize(assessment.expectedBenefit).length<8||
    !arr(assessment.acceptanceEvidence,8)||
    !assessment.acceptanceEvidence.some(c=>
       goalGraph.goal.criteria.includes(c)||graphNode?.covers?.includes(c)))
    return failure('NO_VALUE','NO_MEASURABLE_BENEFIT_OR_GOAL_CRITERION',assessment.alternative);
  if(assessment.possibleDuplicates.length)
    return failure('NEEDS_OWNER_DECISION','POSSIBLE_SEMANTIC_DUPLICATE',assessment.alternative);
  if(!Array.isArray(history)||history.length>250||
    !history.every(r=>plain(r)&&taskId.test(r.id)&&h64.test(r.intentKey)&&
      decisions.has(r.status)))
    return failure('NEEDS_OWNER_DECISION','DURABLE_INTENT_HISTORY_UNVERIFIED');
  const intentKey=hash(JSON.stringify({product,outcome:normalize(assessment.outcome)}));
  const duplicate=history.find(x=>x.id===task.id||x.intentKey===intentKey);
  if(duplicate) return failure(duplicate.status==='ACCEPTED'?'DUPLICATE':duplicate.status,
    'TASK_ALREADY_TRIAGED_OR_SAME_DESIRED_OUTCOME',assessment.alternative);
  return Object.freeze({schema:'asi.task-intake-decision.v1',
    status:'ACCEPTED',reason:assessment.reason,alternative:assessment.alternative,
    authorized:false,executable:false,admitted:false,intentKey,
    taskId:task.id,goalPlanHash:goalGraph.planHash,
    acceptanceEvidence:Object.freeze([...assessment.acceptanceEvidence])});
 }catch{return failure('NEEDS_OWNER_DECISION','UNREADABLE_OR_HOSTILE_ASSESSMENT');}
}
