import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export type WorkerAction676='accept'|'close';
export type WorkerCallback676={
  updateId:number; callbackId:string; taskId:string; nonceHash:string;
  action:WorkerAction676; telegramUserId:string; telegramChatId:string;
};
export type WorkerTransition676='accepted'|'replayed'|'forbidden'|'not_assigned'|'invalid_transition';
export interface WorkerGatewayStore676 {
  applyCallback(callback:WorkerCallback676):Promise<WorkerTransition676>;
  queueNotification(notification:{
    accountId:string;propertyId:string;taskId:string;userId:string;chatId:string;
    nonceHash:string;text:string;
  }):Promise<'created'|'replayed'>;
  recordSendResult(input:{taskId:string;messageId:string|null;code:'dry_run'|'sent'|'retryable'|'dlq'}):Promise<void>;
}
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function safeText(v:unknown) {return typeof v==='string'?v.trim():'';}
function constantEqual(received:string,expected:string):boolean {
  const a=Buffer.from(received),b=Buffer.from(expected);
  return a.length===b.length && timingSafeEqual(a,b);
}
export function assertBotWebhook676(header:string|null,configuredSecret:string):void {
  if(!configuredSecret || configuredSecret.length<24 || !header ||
    !constantEqual(header,configuredSecret)) throw new Error('telegram_webhook_unauthorized');
}
function compactUuid(id:string):string {
 return Buffer.from(id.replace(/-/g,''),'hex').toString('base64url');
}
function expandUuid(compact:string):string {
 if(!/^[A-Za-z0-9_-]{22}$/.test(compact))throw new Error('telegram_invalid_callback_data');
 const bytes=Buffer.from(compact,'base64url');
 if(bytes.length!==16||bytes.toString('base64url')!==compact)throw new Error('telegram_invalid_callback_data');
 const s=bytes.toString('hex');
 return [s.slice(0,8),s.slice(8,12),s.slice(12,16),s.slice(16,20),s.slice(20)].join('-');
}
export function parseBotCallback676(raw:unknown):WorkerCallback676 {
  if(!raw || typeof raw!=='object'||Array.isArray(raw))throw new Error('telegram_invalid_update');
  const u=raw as Record<string,unknown>;
  if(!Number.isSafeInteger(u.update_id)||Number(u.update_id)<0)throw new Error('telegram_invalid_update_id');
  const q=u.callback_query;
  if(!q || typeof q!=='object'||Array.isArray(q))throw new Error('telegram_callback_required');
  const c=q as Record<string,unknown>;
  if(typeof c.id!=='string'||c.id.length>128)throw new Error('telegram_invalid_callback');
  const from=c.from as Record<string,unknown>|undefined;
  const message=c.message as Record<string,unknown>|undefined;
  const chat=message?.chat as Record<string,unknown>|undefined;
  const telegramUserId=from?.id;
  const telegramChatId=chat?.id;
  const validTelegramId=(v:unknown)=>Number.isSafeInteger(v) && Number(v)>0;
  if(!validTelegramId(telegramUserId)||!validTelegramId(telegramChatId))throw new Error('telegram_actor_not_bound');
  const parts=safeText(c.data).split(':');
  if(parts.length!==4||parts[0]!=='asi6'||!['a','c'].includes(parts[1])
    || !/^[a-f0-9]{24}$/.test(parts[3])) throw new Error('telegram_invalid_callback_data');
  const taskId=expandUuid(parts[2]);
  return {
    updateId:Number(u.update_id),callbackId:c.id,action:parts[1]==='a'?'accept':'close',
    taskId,nonceHash:createHash('sha256').update(parts[3]).digest('hex'),
    telegramUserId:String(telegramUserId),telegramChatId:String(telegramChatId),
  };
}
export function createWorkerNotification676(input:{
  accountId:string;propertyId:string;taskId:string;userId:string;chatId:string;
  label:string;nonce?:string;
}) {
  if(![input.accountId,input.propertyId,input.taskId,input.userId].every(x=>ID.test(x))
    || !/^\d{1,20}$/.test(input.chatId) || input.label.length>500)throw new Error('telegram_scope_invalid');
  const nonce=input.nonce??randomBytes(12).toString('hex');
  if(!/^[a-f0-9]{24}$/.test(nonce))throw new Error('telegram_nonce_invalid');
  const text='Задача: '+input.label;
  return {
    accountId:input.accountId,propertyId:input.propertyId,taskId:input.taskId,
    userId:input.userId,chatId:input.chatId,text,
    nonceHash:createHash('sha256').update(nonce).digest('hex'),
    replyMarkup:{inline_keyboard:[[
      {text:'Принять',callback_data:'asi6:a:'+compactUuid(input.taskId)+':'+nonce},
      {text:'Завершить',callback_data:'asi6:c:'+compactUuid(input.taskId)+':'+nonce},
    ]]},
  };
}
export async function receiveWorkerCallback676(
 raw:string,header:string|null,webhookSecret:string,store:WorkerGatewayStore676,
):Promise<{ok:boolean;code:WorkerTransition676}>{
  assertBotWebhook676(header,webhookSecret);
  if(Buffer.byteLength(raw,'utf8')>64_000)throw new Error('telegram_update_too_large');
  let data:unknown;
  try{data=JSON.parse(raw);}catch{throw new Error('telegram_invalid_json');}
  const callback=parseBotCallback676(data);
  const code=await store.applyCallback(callback);
  return {ok:code==='accepted'||code==='replayed',code};
}
export async function dispatchWorkerNotification676(
 input:ReturnType<typeof createWorkerNotification676>,
 store:WorkerGatewayStore676,
 config:{
  noSend:boolean;ownerLiveApproved:boolean;liveEnabled:boolean;
  botToken?:string;fetcher?:typeof fetch;
 }):Promise<'dry_run'|'sent'|'retryable'|'dlq'> {
  const status=await store.queueNotification({
    accountId:input.accountId,propertyId:input.propertyId,taskId:input.taskId,
    userId:input.userId,chatId:input.chatId,text:input.text,nonceHash:input.nonceHash,
  });
  if(status==='replayed')return 'dry_run';
  if(config.noSend || !config.ownerLiveApproved || !config.liveEnabled) {
    await store.recordSendResult({taskId:input.taskId,messageId:null,code:'dry_run'});
    return 'dry_run';
  }
  if(!config.botToken||config.botToken.length<20)throw new Error('telegram_live_credential_missing');
  const fetcher=config.fetcher??fetch;
  let code:'sent'|'retryable'|'dlq'='retryable';
  let messageId:string|null=null;
  try {
    const resp=await fetcher('https://api.telegram.org/bot'+config.botToken+'/sendMessage',{
      method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({chat_id:input.chatId,text:input.text,reply_markup:input.replyMarkup}),
      redirect:'error',signal:AbortSignal.timeout(8000),
    });
    if(resp.ok){
      const json=await resp.json() as {ok?:boolean;result?:{message_id?:number}};
      if(json.ok && Number.isSafeInteger(json.result?.message_id)) {
        code='sent';messageId=String(json.result!.message_id);
      }else code='dlq';
    }else if(resp.status===401||resp.status===403||resp.status===400)code='dlq';
    else if(resp.status===429||resp.status>=500)code='retryable';
    else code='dlq';
  }catch {code='retryable';}
  await store.recordSendResult({taskId:input.taskId,messageId,code});
  return code;
}
