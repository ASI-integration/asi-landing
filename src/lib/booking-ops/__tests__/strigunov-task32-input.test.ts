import {readRequestJson} from '@/lib/safeRequestJson';
import {describe,it,expect} from 'vitest';
import {validatePublicWebIntakePayload} from '../real-booking-intake-autopilot';
describe('Task32 public intake input boundary',()=>{
 it.each([null,[],false,12,'x'])('rejects non-object %j without throwing',value=>{
  expect(validatePublicWebIntakePayload(value as never)).toEqual(expect.any(String));
 });
 it('accepts a descriptive unbound inquiry',()=>expect(validatePublicWebIntakePayload({guestName:'Synthetic',propertyLabel:'Synthetic property'})).toBeNull());
 it.each(['accountId','propertyId','ownerId','metadata'])('rejects authoritative field %s',key=>{
  expect(validatePublicWebIntakePayload({guestName:'Synthetic',propertyLabel:'Synthetic property',[key]:'forged'})).toEqual(expect.any(String));
 });
});

describe('Task32 bounded intake JSON',()=>{
 it('accepts the exact byte limit',async()=>{
  const body=JSON.stringify({value:'ю'});
  expect((await readRequestJson(new Request('http://localhost',{method:'POST',body}),{maxBytes:new TextEncoder().encode(body).length})).ok).toBe(true);
 });
 it('rejects oversized chunked input regardless of content length',async()=>{
  const body=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode('{"value":"'));controller.enqueue(new TextEncoder().encode('x'.repeat(100)+'"}'));controller.close();}});
  const req={body} as Request;
  expect(await readRequestJson(req,{maxBytes:32})).toEqual({ok:false,reason:'invalid'});
 });
 it('rejects invalid byte limits',async()=>{
  expect((await readRequestJson(new Request('http://localhost',{method:'POST',body:'{}'}),{maxBytes:-1})).ok).toBe(false);
 });
});
