// Real service + PostgREST + PostgreSQL evidence. This is not browser/owner/provider acceptance.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';

async function main() {
  assert.equal(process.env.CI,'true');
  assert.equal(process.env.STRIGUNOV_SYNTHETIC_ONLY,'YES');
  assert.match(process.env.LAB_NETWORK ?? '',/^strig32-[0-9]+-1$/);
  assert.equal(process.env.SUPABASE_URL,'http://127.0.0.1:33001');
  const {supabase}=await import('../../src/lib/supabase');
  const {recordAndProcessBookingEvent,recoverUnprocessedBookingEvents,durableEventId}=await import('../../src/lib/booking-ops/lifecycle-autopilot-service');
  const {requireBookingOpsRecordScope}=await import('../../src/lib/booking-ops/repository');
  const {syncBookingOpsCommunications}=await import('../../src/lib/booking-ops/communication-orchestrator');
  const id=JSON.parse(readFileSync('task32-results/reservation.json','utf8')).id as string;
  const scope={accountId:'29300000-0000-4000-8000-000000000002',propertyId:'29300000-0000-4000-8000-000000000003'};
  const phase=process.argv.includes('--variants')?'variants':process.argv.includes('--recover')?'recover':'cycle';
  const results:Array<{id:string;status:string}>=[];
  let stage='scope';let status='FAIL';
  const query=async(table:string)=>{const r=await supabase.from(table).select('*').eq(table==='booking_ops_communication_intents'?'booking_ops_record_id':'booking_id',id);assert.equal(r.error,null);return r.data ?? [];};
  const check=async(name:string,fn:()=>Promise<void>)=>{stage=name;await fn();results.push({id:name,status:'PASS'});};
  const input=(type:string)=>({id:durableEventId(id,type),bookingId:id,objectId:scope.propertyId,type,actorType:'operator' as const,actorId:'task32-synthetic-operator',source:'task32',correlationId:id,payload:{}});
  try {
    await check('scoped-record',async()=>{const r=await requireBookingOpsRecordScope(id,scope);assert.equal(r.id,id);});
    if(phase==='variants'){
      const legal=['booking.received','guest.contacted','guest.data_submitted','guest.documents_uploaded','guest.documents_verified','contract.generated','deposit.confirmed','mvd.completed'];
      const physical=['cleaner.task_completed','linen.task_completed','consumables.task_completed','inspection.completed'];
      const release=['property.ready','checkin.instructions_released'];
      const close=['guest.checked_in','stay.started','checkout.started','checkout.inspection_completed','deposit.return_completed','booking.closed'];
      const ready=[...legal,...physical];
      const variants:Array<{name:string;types:string[];absent?:string;stage?:string;blocked?:boolean;special?:string}>=[
        {name:'V01-happy-closeout',types:[...ready,...release,...close],stage:'closed'},
        {name:'V02-missing-document',types:[...legal.filter(t=>t!=='guest.documents_verified'),...physical,...release],absent:'checkin_released'},
        {name:'V03-missing-deposit',types:[...legal.filter(t=>t!=='deposit.confirmed'),...physical,...release],absent:'checkin_released'},
        {name:'V04-missing-contract',types:[...legal.filter(t=>t!=='contract.generated'),...physical,...release],absent:'checkin_released'},
        {name:'V05-missing-mvd',types:[...legal.filter(t=>t!=='mvd.completed'),...physical,...release],absent:'checkin_released'},
        {name:'V06-cleaning-delay',types:[...legal,...physical.filter(t=>t!=='cleaner.task_completed'),...release],absent:'checkin_released'},
        {name:'V07-linen-shortage',types:[...legal,...physical.filter(t=>t!=='linen.task_completed'),...release],absent:'checkin_released'},
        {name:'V08-supplies-shortage',types:[...legal,...physical.filter(t=>t!=='consumables.task_completed'),...release],absent:'checkin_released'},
        {name:'V09-inspection-pending',types:[...legal,...physical.filter(t=>t!=='inspection.completed'),...release],absent:'checkin_released'},
        {name:'V10-damage-blocks',types:[...ready,'damage.reported'],blocked:true},
        {name:'V11-repair-needs-reinspection',types:[...ready,'damage.reported','maintenance.task_completed'],blocked:true},
        {name:'V12-manual-takeover-keeps-legal-gate',types:['booking.received','manual.override',...release],absent:'checkin_released'},
        {name:'V13-operator-ack-keeps-legal-gate',types:['booking.received','alert.acknowledged',...release],absent:'checkin_released'},
        {name:'V14-provider-failure-keeps-deposit-gate',types:[...legal.filter(t=>t!=='deposit.confirmed'),'deposit.failed',...physical,...release],absent:'deposit_confirmed'},
        {name:'V15-closeout-without-inspection-rejected',types:[...ready,...release,...close.filter(t=>t!=='checkout.inspection_completed')],absent:'closed'},
        {name:'V16-closeout-without-return-rejected',types:[...ready,...release,...close.filter(t=>t!=='deposit.return_completed')],absent:'closed'},
        {name:'V17-concurrent-duplicate-callback',types:legal,special:'duplicate'},
        {name:'V18-timezone-event-persisted',types:legal,special:'timezone'},
        {name:'V19-foreign-scope-denied',types:[],special:'scope'},
        {name:'V20-communication-draft-persisted-no-send',types:['booking.received'],special:'draft'},
      ];
      for(let index=0;index<variants.length;index++){
        const v=variants[index];let vid='';
        await check(v.name,async()=>{

          const response=await fetch('http://127.0.0.1:33100/api/dashboard/booking-ops/intake/process',{method:'POST',headers:{'Content-Type':'application/json',Cookie:'asi_session='+process.env.TASK32_OPERATOR_COOKIE},body:JSON.stringify({source:'admin',action:'process',bookingReference:v.name+'-task32',guestName:'Synthetic '+v.name,guestEmail:'variant'+index+'@example.invalid',propertyId:scope.propertyId,propertyLabel:'Synthetic object',guestCount:1,checkInAt:'2026-10-16T14:00:00Z',checkOutAt:'2026-10-18T11:00:00Z'})});
          assert.equal(response.status,200);const body=await response.json();assert.equal(body.ok,true);assert.equal(body.result.intakeStatus,'processed');vid=body.result.bookingId;assert.ok(vid);

          const event=(type:string)=>({...input(type),id:durableEventId(vid,type),bookingId:vid,correlationId:vid,createdAt:'2026-10-15T12:00:00+03:00',payload:{reason:'synthetic operator decision'}});
          for(const type of v.types)await recordAndProcessBookingEvent(event(type),scope);
          const rows=async(table:string)=>{const r=await supabase.from(table).select('*').eq(table==='booking_ops_communication_intents'?'booking_ops_record_id':'booking_id',vid);assert.equal(r.error,null);return r.data??[];};
          if(v.special==='scope'){const before=(await rows('booking_ops_domain_events')).length;await assert.rejects(()=>recordAndProcessBookingEvent(event('booking.received'),{...scope,accountId:'wrong-owner'}),/scope/);assert.equal((await rows('booking_ops_domain_events')).length,before);return;}
          if(v.special==='duplicate'){const before=(await rows('booking_ops_lifecycle_decisions')).length;const duplicate=await Promise.all(Array.from({length:4},()=>recordAndProcessBookingEvent(event(v.types.at(-1)!),scope)));assert.ok(duplicate.every(r=>r.duplicate));assert.equal((await rows('booking_ops_lifecycle_decisions')).length,before);}
          if(v.special==='timezone'){const events=await rows('booking_ops_domain_events');assert.equal(new Date(events.find(e=>e.id===event('booking.received').id).created_at).toISOString(),'2026-10-15T09:00:00.000Z');}
          if(v.special==='draft'){const record=await requireBookingOpsRecordScope(vid,scope);assert.equal((await syncBookingOpsCommunications({record,tasks:[],expectedScope:scope})).ok,true);const drafts=await rows('booking_ops_communication_intents');assert.ok(drafts.length>0);assert.ok(drafts.every(d=>!['sent','sending'].includes(d.status)&&d.metadata.actual_send_enabled===false));}
          const state=(await rows('booking_ops_autopilot_states'))[0].state;
          if(v.stage)assert.equal(state.stage,v.stage);if(v.absent)assert.ok(!state.completed.includes(v.absent));if(v.blocked)assert.equal(state.readiness,'blocked');
          const events=await rows('booking_ops_domain_events'),decisions=await rows('booking_ops_lifecycle_decisions');assert.equal(events.length,decisions.length);assert.ok(events.every(e=>e.processed_at&&!e.processing_error));
        });
      }
    }else if(phase==='cycle'){
      await check('foreign-account-denied',async()=>{const before=(await query('booking_ops_domain_events')).length;await assert.rejects(()=>recordAndProcessBookingEvent(input('manual.override'),{...scope,accountId:'foreign-account'}),/scope/);assert.equal((await query('booking_ops_domain_events')).length,before);});
      await check('foreign-property-denied',async()=>{const before=(await query('booking_ops_domain_events')).length;await assert.rejects(()=>recordAndProcessBookingEvent(input('manual.override'),{...scope,propertyId:'foreign-object'}),/scope/);assert.equal((await query('booking_ops_domain_events')).length,before);});
      await check('actual-communication-service-draft-only',async()=>{
        const record=await requireBookingOpsRecordScope(id,scope);
        assert.equal(record.readiness?.status,'missing_documents');
        stage='communication-service-result';const r=await syncBookingOpsCommunications({record,tasks:[],expectedScope:scope});assert.equal(r.ok,true);
        stage='communication-persisted-drafts';const drafts=await query('booking_ops_communication_intents');assert.ok(drafts.length>0);
        for(const draft of drafts){assert.ok(!['sent','sending'].includes(draft.status));assert.equal(draft.metadata.actual_send_enabled,false);}
      });
      const types=['booking.received','guest.contacted','guest.data_submitted','guest.documents_uploaded','guest.documents_verified','contract.generated','deposit.confirmed','mvd.completed','cleaner.task_completed','linen.task_completed','consumables.task_completed','inspection.completed','property.ready','checkin.instructions_released','guest.checked_in','stay.started','checkout.started','checkout.inspection_completed','deposit.return_completed'];
      for(const type of types)await check(type,async()=>{await recordAndProcessBookingEvent(input(type),scope);const rows=await query('booking_ops_domain_events');assert.ok(rows.some(r=>r.id===input(type).id&&r.processed_at));});
      await check('concurrent-duplicate-callback',async()=>{const before=await query('booking_ops_lifecycle_decisions');const r=await Promise.all(Array.from({length:4},()=>recordAndProcessBookingEvent(input('deposit.return_completed'),scope)));assert.ok(r.every(x=>x.duplicate));assert.equal((await query('booking_ops_lifecycle_decisions')).length,before.length);});
      await check('durable-unprocessed-closeout-fixture',async()=>{const event=input('booking.closed');const r=await supabase.from('booking_ops_domain_events').insert({id:event.id,booking_id:id,object_id:scope.propertyId,event_type:event.type,actor_type:event.actorType,actor_id:event.actorId,payload:{},source:event.source,correlation_id:id});assert.equal(r.error,null);});
    }else{
      await check('fresh-process-durable-recovery',async()=>{const before=await query('booking_ops_domain_events');assert.equal(before.filter(r=>!r.processed_at).length,1);const recovered=await recoverUnprocessedBookingEvents();assert.equal(recovered.errors.length,0);assert.equal(recovered.processed,1);});
      await check('durable-closeout-and-audit',async()=>{
        const states=await query('booking_ops_autopilot_states');assert.equal(states[0].stage,'closed');
        const projections=await query('booking_ops_lifecycle_states');assert.equal(projections[0].status,'completed');assert.equal(projections[0].next_action,null);assert.equal(projections[0].metadata.noExternalSend,true);
        const tasks=await query('booking_ops_worker_tasks');assert.ok(tasks.length>=5);assert.ok(tasks.every(t=>t.status==='completed'));
        const events=await query('booking_ops_domain_events');assert.ok(events.every(e=>e.processed_at&&!e.processing_error));const audit=await query('booking_ops_lifecycle_decisions');assert.equal(audit.length,events.length);
      });
      await check('restart-replay-no-extra-decision',async()=>{const before=await query('booking_ops_lifecycle_decisions');assert.equal((await recordAndProcessBookingEvent(input('booking.closed'),scope)).duplicate,true);assert.equal((await query('booking_ops_lifecycle_decisions')).length,before.length);});
      await check('no-sent-intents-after-closeout',async()=>{const drafts=await query('booking_ops_communication_intents');assert.ok(drafts.length>0);assert.ok(drafts.every(d=>!['sent','sending'].includes(d.status)&&d.metadata.actual_send_enabled===false));});
    }
    status='PASS';
  }catch {results.push({id:stage,status:'FAIL'});process.exitCode=1;}
  finally {
    writeFileSync('task32-results/booking-'+phase+'.json',JSON.stringify({source:process.env.REVIEWED_SOURCE_SHA,phase,status,results,synthetic:true,noExternalSend:true,limits:['reservation row created through real session-authorized intake API','legal/worker/approval events are synthetic signals; real provider/worker identity is not exercised','sealed CRM cookies do not prove login issuance or revocation','optional property knowledge may be unavailable','service-role SQL authority, application scope checks are exercised','one durable service cycle and 20 durable service variants plus component scenarios; reservation intake/browser/provider full E2E remains incomplete']},null,2));
  }
}
main().catch(()=>{process.exitCode=1;});
