/**
 * #676 database-bound adapters. Server-only. Nothing here connects to a
 * provider; SQL functions must exist and accept only service_role.
 */
import { supabase } from '@/lib/supabase';
import type { IngressStore676 } from './provider-ingress-676';
import type { WorkerGatewayStore676 } from './telegram-task-gateway-676';

function requiredRpcResult(value:unknown):string {
  if(typeof value!=='string') throw new Error('ingress_rpc_invalid_result');
  return value;
}
export function postgresIngressStore676():IngressStore676 {
 return {
  async apply(e){
   const {data,error}=await supabase.rpc('asi_ingest_event_676',{
    p_account:e.accountId,p_property:e.propertyId,p_source:e.sourceId,
    p_external:e.externalId,p_recurrence:e.recurrenceId,
    p_start:e.startAt,p_end:e.endAt,p_seq:e.sequence,
    p_cancelled:e.cancelled,p_hash:e.eventHash,
   });
   if(error) throw new Error('ingress_rpc_failed');
   const result=requiredRpcResult(data);
   if(!['accepted','replayed','stale','cancelled','conflict_review'].includes(result)) throw new Error('ingress_rpc_unknown_status');
   return result as 'accepted'|'replayed'|'stale'|'cancelled'|'conflict_review';
  },
  async commitCursor(input){
   const {error}=await supabase.rpc('asi_ingress_commit_cursor_676',{
    p_account:input.accountId,p_property:input.propertyId,p_source:input.sourceId,p_cursor:input.cursor,
   });
   if(error)throw new Error('ingress_cursor_commit_failed');
  },
  async deadLetter(e){
   const {error}=await supabase.rpc('asi_ingress_dlq_676',{
    p_account:e.accountId,p_property:e.propertyId,p_source:e.sourceId,
    p_hash:e.key,p_code:e.code,
   });
   if(error)throw new Error('ingress_dlq_failed');
  },
 };
}
export function postgresTelegramStore676():WorkerGatewayStore676 {
 return {
  async applyCallback(callback){
   const {data,error}=await supabase.rpc('asi_telegram_transition_676',{
    p_task:callback.taskId,p_update:callback.updateId,
    p_from:Number(callback.telegramUserId),p_chat:Number(callback.telegramChatId),
    p_nonce:callback.nonceHash,p_action:callback.action,
   });
   if(error) throw new Error('telegram_transition_failed');
   const result=requiredRpcResult(data);
   if(!['accepted','replayed','forbidden','not_assigned','invalid_transition'].includes(result))throw new Error('telegram_unknown_status');
   return result as 'accepted'|'replayed'|'forbidden'|'not_assigned'|'invalid_transition';
  },
  async queueNotification(n){
   const {data,error}=await supabase.rpc('asi_telegram_enqueue_676',{
    p_account:n.accountId,p_property:n.propertyId,p_task:n.taskId,p_user:n.userId,
    p_chat:Number(n.chatId),p_nonce_hash:n.nonceHash,p_text:n.text,
   });
   if(error)throw new Error('telegram_queue_failed');
   const result=requiredRpcResult(data);
   if(result==='not_assigned')throw new Error('telegram_unbound_assignment');
   if(result!=='created' && result!=='replayed')throw new Error('telegram_queue_unknown_status');
   return result;
  },
  async recordSendResult(n){
   const {error}=await supabase.from('asi_telegram_outbox_676')
    .update({send_status:n.code==='dry_run'?'queued_dry_run':n.code,message_id:n.messageId})
    .eq('task_id',n.taskId);
   if(error)throw new Error('telegram_outbox_update_failed');
  },
 };
}
export async function readBoundedText676(req:Request,maxBytes:number):Promise<string> {
  const length=Number(req.headers.get('content-length')||0);
  if(Number.isFinite(length) && length>maxBytes)throw new Error('payload_too_large');
  if(!req.body)throw new Error('payload_missing');
  const reader=req.body.getReader();
  const chunks:Uint8Array[]=[];
  let size=0;
  try {
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>maxBytes)throw new Error('payload_too_large');
      chunks.push(value);
    }
  } finally {reader.releaseLock();}
  const all=new Uint8Array(size);
  let cursor=0;
  for(const chunk of chunks){all.set(chunk,cursor);cursor+=chunk.length;}
  try{return new TextDecoder('utf-8',{fatal:true}).decode(all);}
  catch{throw new Error('payload_invalid_utf8');}
}
