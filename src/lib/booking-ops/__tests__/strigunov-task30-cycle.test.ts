import {beforeEach,describe,it,expect,vi} from 'vitest';
import {initialLifecycleState,reduceLifecycle,type LifecycleState,type LifecycleEvent} from '../lifecycle-autopilot';
import {lifecycleProjection} from '../lifecycle-convergence';
import {computePhysicalReadiness,canReleaseCheckInInstructions,validateCleaningTransition,assertPhysicalApprovalAllowed,buildPhysicalCoordinationDraftText} from '../physical-readiness-execution';
import {evaluateOpsTurnover} from '../ops-alert-engine';
import {normalizePublicPilotLead} from '@/lib/early-access/public-pilot-lead';
import {processPublicPilotLead,resetPublicPilotLeadRateLimitForTests} from '@/lib/early-access/public-lead-rate-limit';
import {parseCreateBookingOpsInput} from '../validation';
import {canAutoSendCommunicationIntent,type CommunicationAutoSendPolicy} from '../communication-auto-send-policy';
import {planBookingOpsCommunications} from '../communication-orchestrator';
import type {BookingOpsRecord,BookingOpsCommunicationIntent} from '../types';
// Actual pure production components. No mocked CRM/DB/transport. Persistence callbacks in S25/S26 are stubs;
// authenticated operator actions and provider execution are explicitly NOT covered here.
const owner={name:'ASI_TEST_TASK30',contact:'owner@example.invalid',objectsCount:'1 объект',referral:'strigunov',consent:true};
const bid='task30-reservation',objectId='task30-object',now='2026-10-15T09:00:00Z';
let seq=0;
function event(type:string,payload:Record<string,unknown>={}):LifecycleEvent{return {id:'event-'+(++seq),bookingId:bid,objectId,type,payload,actorType:'operator',actorId:'synthetic-operator',source:'task30',correlationId:'task30',createdAt:now};}
const apply=(s:LifecycleState,t:string,p:Record<string,unknown>={})=>reduceLifecycle(s,event(t,p)).state;
const legal=['booking.received','guest.contacted','guest.data_submitted','guest.documents_uploaded','guest.documents_verified','contract.generated','deposit.confirmed','mvd.completed'];
const physical=['cleaner.task_completed','linen.task_completed','consumables.task_completed','inspection.completed'];
const close=['property.ready','checkin.instructions_released','guest.checked_in','stay.started','checkout.started','checkout.inspection_completed','deposit.return_completed','booking.closed'];
const run=(types:string[])=>types.reduce((s,t)=>apply(s,t),initialLifecycleState());
const ready={cleaningStatus:'verified',linenStatus:'verified',suppliesStatus:'verified',finalApproved:true};
const policy:CommunicationAutoSendPolicy={scope:'global',scopeRef:null,messageType:'guest_data_missing_notice',channel:'any',autoSendEnabled:true,actualSendEnabled:false,requiresReview:false,quietHoursEnabled:false,quietHoursStart:null,quietHoursEnd:null,maxAutoSendsPerBookingPerDay:3,maxAutoSendsPerGuestPerDay:3,allowedRecipientRoles:['guest'],blockedKeywords:[],requiredMetadata:[]};
const intent:BookingOpsCommunicationIntent={id:'draft',bookingOpsRecordId:bid,bookingId:bid,relatedTaskId:null,actorType:'guest',actorLabel:'Synthetic guest',purpose:'request_arrival_time',channel:'manual',status:'draft_ready',messageText:'Уточните время прибытия.',messageTemplateKey:'guest.arrival.v1',metadata:{},createdAt:now,updatedAt:now,supersededAt:null};
const context={policy,bookingAutoSendsToday:0,guestAutoSendsToday:0};
beforeEach(()=>{seq=0;resetPublicPilotLeadRateLimitForTests();});
describe('Task30 component scenario matrix — not durable full E2E',()=>{
 it('S01 owner intake and reservation validation use real normalizers',()=>{expect(normalizePublicPilotLead(owner).ok).toBe(true);expect(parseCreateBookingOpsInput({guestName:'Synthetic guest',propertyId:objectId,bookingId:bid})).toHaveProperty('input');});
 it('S02 missing consent remains rejected',()=>expect(normalizePublicPilotLead({...owner,consent:false}).ok).toBe(false));
 it('S03 null anonymous payload fails closed instead of throwing',()=>expect(normalizePublicPilotLead(null as never).ok).toBe(false));
 it('S04 full event cycle closes with no stale tasks and no-send projection',()=>{const s=run([...legal,...physical,...close]);expect(s.stage).toBe('closed');expect(s.tasks.every(t=>t.status==='completed')).toBe(true);expect(lifecycleProjection(s,objectId)).toMatchObject({status:'completed',next_action:null,metadata:{noExternalSend:true}});expect(s.audit.length).toBeGreaterThan(15);});
 it('S05 duplicate callback creates no second task or audit',()=>{const e=event('mvd.completed');const first=reduceLifecycle(run(legal.slice(0,-1)),e);const second=reduceLifecycle(first.state,e,new Set([e.id]));expect(second).toMatchObject({duplicate:true,tasksToCreate:[],eventsToEmit:[]});expect(second.state).toBe(first.state);});
 it('S06 missing documents prevent turnover release',()=>{const s=run(legal.filter(t=>t!=='guest.documents_verified'));expect(s.tasks).toHaveLength(0);expect(apply(s,'checkin.instructions_released').completed).not.toContain('checkin_released');});
 it('S07 missing deposit prevents release',()=>expect(apply(run(legal.filter(t=>t!=='deposit.confirmed')),'checkin.instructions_released').completed).not.toContain('checkin_released'));
 it('S08 deposit provider failure cannot mark payment complete',()=>{const s=apply(run(legal.filter(t=>t!=='deposit.confirmed')),'deposit.failed');expect(s.completed).not.toContain('deposit_confirmed');expect(s.readiness).toBe('blocked');});
 it('S09 manual takeover preserves legal blockers and records reason',()=>{const s=apply(initialLifecycleState(),'manual.override',{reason:'operator takeover'});expect(s.readiness).toBe('blocked');expect(s.completed).toEqual([]);expect(s.audit.at(-1)?.decision).toContain('operator takeover');});
 it('S10 operator cannot approve unresolved physical blockers',()=>expect(()=>assertPhysicalApprovalAllowed(computePhysicalReadiness({...ready,cleaningStatus:'pending'}).operationalBlockers)).toThrow('physical_blockers_exist'));
 it('S11 cleaning delay produces an operator condition',()=>{const r=evaluateOpsTurnover({turnoverId:'turnover',propertyId:objectId,nextBookingId:bid,nextCheckInAt:'2026-10-15T10:00:00Z',now,cleaning:{status:'pending',assigned:false},linen:{status:'verified'},inspection:{status:'verified'},maintenance:[],finalReady:false});expect(r.conditions.some(x=>x.sourceGate==='cleaning')).toBe(true);});
 it('S12 cleaning assignment needs executor',()=>expect(()=>validateCleaningTransition({currentStatus:'pending',nextStatus:'assigned',hasExecutor:false})).toThrow('cleaning_executor_required'));
 it('S13 cleaning cannot skip work to verification',()=>expect(()=>validateCleaningTransition({currentStatus:'pending',nextStatus:'verified',hasExecutor:true})).toThrow('cleaning_transition_invalid'));
 it('S14 rejected/cancelled cleaning is terminal',()=>expect(()=>validateCleaningTransition({currentStatus:'cancelled',nextStatus:'assigned',hasExecutor:true})).toThrow('cleaning_cancelled_is_terminal'));
 it('S15 completed cleaning still requires verification',()=>expect(computePhysicalReadiness({...ready,cleaningStatus:'completed'}).finalReady).toBe(false));
 it('S16 linen shortage blocks readiness',()=>expect(computePhysicalReadiness({...ready,linenStatus:'pending'}).blockers.map(x=>x.key)).toContain('linen_not_verified'));
 it('S17 supplies waiver requires a reason',()=>{expect(computePhysicalReadiness({...ready,suppliesStatus:'waived'}).finalReady).toBe(false);expect(computePhysicalReadiness({...ready,suppliesStatus:'waived',suppliesWaiverReason:'synthetic approved substitute'}).finalReady).toBe(true);});
 it('S18 final human approval is separate from task completion',()=>{expect(computePhysicalReadiness({...ready,finalApproved:false})).toMatchObject({status:'ready_for_review',finalReady:false});expect(computePhysicalReadiness(ready).finalReady).toBe(true);});
 it('S19 physical readiness cannot bypass legal gate',()=>expect(canReleaseCheckInInstructions({legalReady:false,physical:computePhysicalReadiness(ready)}).allowed).toBe(false));
 it('S20 damage requires repair and exact reinspection',()=>{let s=apply(run([...legal,...physical]),'damage.reported');expect(s.readiness).toBe('blocked');s=apply(s,'maintenance.task_completed');const t=s.tasks.find(x=>x.key.includes(':reinspection:'));expect(t).toBeDefined();expect(s.blockers).toContain('reinspection_required');s=apply(s,'inspection.completed',{taskKey:t?.key});expect(s.readiness).toBe('ready');});
 it('S21 actual coordination draft explicitly requires manual review',()=>{const draft=buildPhysicalCoordinationDraftText({taskType:'cleaning',property:objectId,bookingDates:now,deadline:now});expect(draft).toContain('Это черновик');expect(draft).toContain('после проверки оператором');});
 it('S22 actual communication planner creates drafts only and converges',()=>{const first=planBookingOpsCommunications({record:baseRecord,tasks:[]});expect(first.toCreate.length).toBeGreaterThan(0);expect(first.toCreate.every(x=>['draft_ready','waiting_for_external_input'].includes(x.status))).toBe(true);const existing=first.toCreate.map((x,i)=>({...x,id:'draft-'+i,bookingOpsRecordId:bid,bookingId:bid,metadata:x.metadata??{},createdAt:now,updatedAt:now,supersededAt:null}));const second=planBookingOpsCommunications({record:baseRecord,tasks:[],existingCommunications:existing});expect(second.toCreate).toEqual([]);});
 it('S23 quiet-hours boundary defers communication',async()=>{const r=await canAutoSendCommunicationIntent(intent,{...context,policy:{...policy,quietHoursEnabled:true,quietHoursStart:'22:00',quietHoursEnd:'08:00'},now:new Date(2026,9,15,23,0)});expect(r.allowed).toBe(false);expect(r.decision).toBe('quiet_hours');});
 it('S24 daily booking quota denies another draft send',async()=>{const r=await canAutoSendCommunicationIntent(intent,{...context,bookingAutoSendsToday:3});expect(r.allowed).toBe(false);});
 it('S25 failed persistence never becomes a successful replay',async()=>{const n=normalizePublicPilotLead(owner);if(!n.ok)throw Error('fixture');const failed=vi.fn(async()=>{throw Error('provider boundary failure');});await expect(processPublicPilotLead(n.input,failed)).rejects.toThrow();const persist=vi.fn(async()=>{});expect(await processPublicPilotLead(n.input,persist)).toMatchObject({allowed:true,replayed:false});expect(persist).toHaveBeenCalledTimes(1);});
 it('S26 concurrent same-process acceptance persists once',async()=>{const n=normalizePublicPilotLead(owner);if(!n.ok)throw Error('fixture');const persist=vi.fn(async()=>{});const rs=await Promise.all(Array.from({length:5},()=>processPublicPilotLead(n.input,persist)));expect(persist).toHaveBeenCalledTimes(1);expect(rs.filter(r=>r.allowed&&r.replayed)).toHaveLength(4);});
 it('S27 serialized event replay reconstructs same closeout projection',()=>{const types=[...legal,...physical,...close];const events=types.map(t=>event(t));const reduce=(es:LifecycleEvent[])=>es.reduce((s,e)=>reduceLifecycle(s,e).state,initialLifecycleState());expect(reduce(JSON.parse(JSON.stringify(events)))).toEqual(reduce(events));});
 it('S28 equivalent timezone timestamps produce identical delay conditions',()=>{const base={turnoverId:'turnover',propertyId:objectId,nextBookingId:bid,cleaning:{status:'pending',assigned:false},linen:{status:'verified'},inspection:{status:'verified'},maintenance:[],finalReady:false};expect(evaluateOpsTurnover({...base,now:'2026-10-15T09:00:00Z',nextCheckInAt:'2026-10-15T10:00:00Z'})).toEqual(evaluateOpsTurnover({...base,now:'2026-10-15T12:00:00+03:00',nextCheckInAt:'2026-10-15T13:00:00+03:00'}));});
 it('S29 policy approval never enables actual send in the synthetic fixture',async()=>{const r=await canAutoSendCommunicationIntent(intent,context);expect(r.allowed).toBe(true);expect(r.actual_send_enabled).toBe(false);});
});
// Fixture values only; no live owner, provider or external address.
const baseRecord:BookingOpsRecord = {
  id: 'ops-1',
  bookingId: 'reservation-1',
  guestName: 'Synthetic guest',
  guestPhone: '',
  guestEmail: null,
  guestTelegram: '',
  propertyId: 'OBJ-1',
  propertyLabel: 'Synthetic object',
  otaSource: 'avito',
  checkInAt: '2026-07-01T14:00:00.000Z',
  checkOutAt: '2026-07-03T11:00:00.000Z',
  opsStatus: 'created',
  manualNextAction: null,
  isBlocked: false,
  blockerReason: null,
  documentsStatus: 'not_started',
  contractStatus: 'not_started',
  depositStatus: 'not_started',
  mvdStatus: 'not_required',
  checkinReadinessStatus: 'not_started',
  unitReadinessStatus: 'not_ready',
  notes: 'SYNTHETIC ONLY',
  guestCount: 2,
  paymentStatus: 'paid',
  documentRequired: null,
  documentCollected: null,
  documentVerificationStatus: null,
  documentNotes: null,
  contractRequired: null,
  contractProvider: null,
  contractIntakeStatus: null,
  contractLink: null,
  contractNotes: null,
  depositRequired: null,
  depositAmount: null,
  depositIntakeStatus: null,
  depositPaymentMethod: null,
  depositNotes: null,
  mvdRequired: null,
  mvdDataStatus: null,
  mvdConfirmationLink: null,
  mvdNotes: null,
  createdAt: '2026-06-27T08:00:00.000Z',
  updatedAt: '2026-06-27T08:00:00.000Z',
};
