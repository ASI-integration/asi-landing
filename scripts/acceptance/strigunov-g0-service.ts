import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
async function main(){
 assert.equal(process.env.CI,'true');assert.equal(process.env.STRIGUNOV_SYNTHETIC_ONLY,'YES');assert.match(process.env.LAB_NETWORK??'',/^strigfin-[0-9]+-1$/);assert.equal(process.env.SUPABASE_URL,'http://127.0.0.1:33001');
 const {supabase}=await import('../../src/lib/supabase');
 const {recordAndProcessBookingEvent,durableEventId}=await import('../../src/lib/booking-ops/lifecycle-autopilot-service');
 const {requireBookingOpsRecordScope}=await import('../../src/lib/booking-ops/repository');
 const {syncBookingOpsCommunications}=await import('../../src/lib/booking-ops/communication-orchestrator');
 const id=JSON.parse(readFileSync('finishline-results/reservation.json','utf8')).id as string;
 const scope={accountId:'29300000-0000-4000-8000-000000000002',propertyId:'29300000-0000-4000-8000-000000000003'};
 const results:Array<{gate:string;id:string;status:string;error?:string}>=[];
 const check=async(name:string,fn:()=>Promise<void>)=>{try{await fn();results.push({gate:'G0-3',id:name,status:'PASS'});}catch(e){results.push({gate:'G0-3',id:name,status:'FAIL',error:String(e).slice(0,250)});}};
 const event=async(type:string,suffix='')=>recordAndProcessBookingEvent({id:durableEventId(id,'g0:'+type+suffix),bookingId:id,objectId:scope.propertyId,type,actorType:'operator',actorId:'g0-synthetic',source:'g0-synthetic',correlationId:id,payload:{reason:'synthetic approved evidence, no external provider'}},scope);
 const rows=async(table:string)=>{const r=await supabase.from(table).select('*').eq(table==='booking_ops_communication_intents'?'booking_ops_record_id':'booking_id',id);assert.equal(r.error,null);return r.data??[];};
 const state=async()=>(await rows('booking_ops_autopilot_states'))[0].state;
 const {reconcileOperatorAlertConditions}=await import('../../src/lib/booking-ops/operator-alerts');
 await check('durable-four-synthetic-incident-alerts',async()=>{await reconcileOperatorAlertConditions({...scope,bookingId:id,managedSourceDomains:['g0'],now:new Date().toISOString(),conditions:['missing_documents','deposit_unconfirmed','cleaning_delayed','provider_uncertain'].map(code=>({code,incidentFamily:code,sourceDomain:'g0',sourceGate:code,severity:'critical' as const,title:'G0 '+code,description:'Synthetic fault injection',recommendedAction:'Manual reconciliation; no send',deadlineAt:null}))});const alerts=await rows('booking_ops_alerts');assert.equal(alerts.filter(a=>a.source_domain==='g0').length,4);writeFileSync('finishline-results/alerts.json',JSON.stringify({source:process.env.REVIEWED_SOURCE_SHA,ids:alerts.filter(a=>a.source_domain==='g0').map(a=>a.id)}));});
 await check('missing-doc-deposit-cleaning-ack-cannot-release',async()=>{await event('manual.override');await event('alert.acknowledged');await event('checkin.instructions_released','premature');assert.ok(!(await state()).completed.includes('checkin_released'));});
 await check('real-draft-service-persists-no-send',async()=>{const record=await requireBookingOpsRecordScope(id,scope);assert.equal((await syncBookingOpsCommunications({record,tasks:[],expectedScope:scope})).ok,true);const drafts=await rows('booking_ops_communication_intents');assert.ok(drafts.length);assert.ok(drafts.every(d=>!['sent','sending'].includes(d.status)&&d.metadata.actual_send_enabled===false));});
 await check('synthetic-prerequisites-to-checkin',async()=>{for(const t of ['booking.received','guest.contacted','guest.data_submitted','guest.documents_uploaded','guest.documents_verified','contract.generated','deposit.confirmed','mvd.completed','cleaner.task_completed','linen.task_completed','consumables.task_completed','inspection.completed','property.ready','checkin.instructions_released','guest.checked_in','stay.started','checkout.started'])await event(t);assert.ok((await state()).completed.includes('checkin_released'));});
 await check('closeout-rejects-missing-inspection',async()=>{await event('booking.closed','premature');assert.notEqual((await state()).stage,'closed');});
 await check('approved-inspection-and-return-closeout',async()=>{await event('checkout.inspection_completed');await event('deposit.return_completed');await event('booking.closed');assert.equal((await state()).stage,'closed');const tasks=await rows('booking_ops_worker_tasks');assert.ok(tasks.length>=5);assert.ok(tasks.every(t=>t.status==='completed'));});
 await check('duplicate-callback-no-extra-decision',async()=>{const before=(await rows('booking_ops_lifecycle_decisions')).length;const replies=await Promise.all([event('booking.closed'),event('booking.closed')]);assert.ok(replies.every(r=>r.duplicate));assert.equal((await rows('booking_ops_lifecycle_decisions')).length,before);});
 writeFileSync('finishline-results/service.json',JSON.stringify({source:process.env.REVIEWED_SOURCE_SHA,results},null,2));if(results.some(r=>r.status==='FAIL'))process.exitCode=1;
}
main().catch(()=>{process.exitCode=1;});
