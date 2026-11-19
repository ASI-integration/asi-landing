import {describe,it,expect,vi} from 'vitest';
import {assertBotWebhook676,parseBotCallback676,createWorkerNotification676,dispatchWorkerNotification676,receiveWorkerCallback676,type WorkerGatewayStore676} from '../telegram-task-gateway-676';
const input={
 accountId:'11111111-1111-4111-8111-111111111111',propertyId:'22222222-2222-4222-8222-222222222222',
 taskId:'33333333-3333-4333-8333-333333333333',userId:'44444444-4444-4444-8444-444444444444',
 chatId:'987654',label:'Clean property A',nonce:'aaaaaaaaaaaaaaaaaaaaaaaa',
};
const secret='very-long-test-webhook-secret-no-external';
const note=createWorkerNotification676(input);
const payload=(action:string,id=23)=>JSON.stringify({update_id:id,callback_query:{
 id:'cb-23',from:{id:123456},message:{chat:{id:987654}},
 data:'asi6:'+(action==='accept'?'a':'c')+':'+Buffer.from(input.taskId.replace(/-/g,''),'hex').toString('base64url')+':'+input.nonce,
}});
function store():WorkerGatewayStore676 {
 return {applyCallback:vi.fn(async()=> 'accepted' as const),queueNotification:vi.fn(async()=> 'created' as const),recordSendResult:vi.fn(async()=>{})};
}
describe('#676 Telegram Bot API no-send webhook task gateway',()=>{
 it('exact webhook secret required and rejects spoofs',()=>{
  assertBotWebhook676(secret,secret);
  expect(()=>assertBotWebhook676(null,secret)).toThrow('unauthorized');
  expect(()=>assertBotWebhook676(secret+'x',secret)).toThrow('unauthorized');
 });
 it('validates callback, task, chat, update id and nonce',()=>{
  expect(parseBotCallback676(JSON.parse(payload('accept')))).toMatchObject({
   action:'accept',updateId:23,taskId:input.taskId,
   telegramChatId:'987654',telegramUserId:'123456',nonceHash:note.nonceHash,
  });
  expect(()=>parseBotCallback676(JSON.parse(payload('close',-1)))).toThrow('invalid_update_id');
  expect(()=>parseBotCallback676({update_id:2,callback_query:{id:'x'}})).toThrow();
 });
 it('forms only task-scoped accept/close action buttons',()=>{
  const compact=Buffer.from(input.taskId.replace(/-/g,''),'hex').toString('base64url');
  expect(note.replyMarkup.inline_keyboard[0].map(x=>x.callback_data)).toEqual([
   'asi6:a:'+compact+':'+input.nonce,
   'asi6:c:'+compact+':'+input.nonce,
  ]);
  expect(note.replyMarkup.inline_keyboard[0].every(x=>Buffer.byteLength(x.callback_data,'utf8')<=64)).toBe(true);
  expect(()=>createWorkerNotification676({...input,propertyId:'other-tenant'})).toThrow('scope_invalid');
 });
 it('rejects untrusted callback before it reaches transaction',async()=>{
  const s=store();
  await expect(receiveWorkerCallback676(payload('accept'),'wrong',secret,s)).rejects.toThrow('unauthorized');
  expect(s.applyCallback).not.toHaveBeenCalled();
  expect(await receiveWorkerCallback676(payload('accept'),secret,secret,s)).toEqual({ok:true,code:'accepted'});
  expect(s.applyCallback).toHaveBeenCalledWith(expect.objectContaining({nonceHash:note.nonceHash}));
 });
 it('duplicate updates idempotent; foreign assignments rejected',async()=>{
  const s=store();vi.mocked(s.applyCallback).mockResolvedValueOnce('replayed').mockResolvedValueOnce('not_assigned');
  expect((await receiveWorkerCallback676(payload('close'),secret,secret,s)).ok).toBe(true);
  expect((await receiveWorkerCallback676(payload('close'),secret,secret,s)).ok).toBe(false);
 });
 it('no-send prevents Telegram fetch regardless of token and owner approval',async()=>{
  const s=store(),fetcher=vi.fn();
  expect(await dispatchWorkerNotification676(note,s,{noSend:true,ownerLiveApproved:true,liveEnabled:true,botToken:'a'.repeat(40),fetcher})).toBe('dry_run');
  expect(fetcher).not.toHaveBeenCalled();
  expect(s.recordSendResult).toHaveBeenCalledWith(expect.objectContaining({code:'dry_run'}));
 });
 it('missing explicit owner consent or live toggle prevents Telegram',async()=>{
  const s=store(),fetcher=vi.fn();
  await dispatchWorkerNotification676(note,s,{noSend:false,ownerLiveApproved:false,liveEnabled:true,fetcher});
  await dispatchWorkerNotification676(note,s,{noSend:false,ownerLiveApproved:true,liveEnabled:false,fetcher});
  expect(fetcher).not.toHaveBeenCalled();
 });
 it('mock provider responses 200,401,429 and timeout',async()=>{
  const s=store(),cfg={noSend:false,ownerLiveApproved:true,liveEnabled:true,botToken:'a'.repeat(40)};
  expect(await dispatchWorkerNotification676(note,s,{...cfg,fetcher:async()=>new Response(JSON.stringify({ok:true,result:{message_id:77}}),{status:200})})).toBe('sent');
  expect(await dispatchWorkerNotification676(note,s,{...cfg,fetcher:async()=>new Response('',{status:429})})).toBe('retryable');
  expect(await dispatchWorkerNotification676(note,s,{...cfg,fetcher:async()=>new Response('',{status:401})})).toBe('dlq');
  expect(await dispatchWorkerNotification676(note,s,{...cfg,fetcher:async()=>{throw Error('timeout');}})).toBe('retryable');
 });
});
