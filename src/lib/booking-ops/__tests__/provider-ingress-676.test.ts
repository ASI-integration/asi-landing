import { createHmac } from 'node:crypto';
import { describe,it,expect,vi } from 'vitest';
import {parseIcal676,parseOtaWebhook676,verifyIngressSignature676,importInbound676,fetchConfiguredIcal676,pollIcalFeed676,type IngressStore676} from '../provider-ingress-676';

const scope={accountId:'11111111-1111-4111-8111-111111111111',propertyId:'22222222-2222-4222-8222-222222222222',sourceId:'trusted_ical'};
function ics(e:string){return ['BEGIN:VCALENDAR','VERSION:2.0',e,'END:VCALENDAR'].join('\r\n');}
function event(uid:string,start:string,end:string){
 return ['BEGIN:VEVENT','UID:'+uid,'SEQUENCE:1','DTSTART'+start,'DTEND'+end,'STATUS:CONFIRMED','END:VEVENT'].join('\r\n');
}
describe('#676 iCal and incoming OTA adapter',()=>{
 it('all-day exclusive checkout, folded UID and tenant scope',()=>{
  const e=event('base-one',':20261124',':20261126').replace('UID:base-one','UID:base-\r\n one');
  const row=parseIcal676(ics(e),scope)[0];
  expect(row).toMatchObject({externalId:'base-one',accountId:scope.accountId,propertyId:scope.propertyId,startAt:'2026-11-24T00:00:00.000Z',endAt:'2026-11-26T00:00:00.000Z'});
 });
 it('DST winter/summer and first fall repeated local time',()=>{
  const p=(uid:string,date:string,end:string)=>parseIcal676(ics(event(uid,';TZID=Europe/Berlin:'+date,';TZID=Europe/Berlin:'+end)),scope)[0].startAt;
  expect(p('before','20260328T120000','20260328T130000')).toBe('2026-03-28T11:00:00.000Z');
  expect(p('after','20260329T120000','20260329T130000')).toBe('2026-03-29T10:00:00.000Z');
  expect(p('fall','20261025T023000','20261025T043000')).toBe('2026-10-25T00:30:00.000Z');
 });
 it('rejects DST gap, missing timezone and unexploded RRULE',()=>{
  expect(()=>parseIcal676(ics(event('gap',';TZID=Europe/Berlin:20260329T023000',';TZID=Europe/Berlin:20260329T043000')),scope)).toThrow('ical_dst_gap');
  expect(()=>parseIcal676(ics(event('float',':20261124T120000',':20261124T150000')),scope)).toThrow('ical_floating');
  expect(()=>parseIcal676(ics(event('rule',':20261124',':20261126').replace('END:VEVENT','RRULE:FREQ=DAILY;COUNT=2\r\nEND:VEVENT')),scope)).toThrow('recurrence_expansion');
  expect(()=>parseIcal676(ics(event('range',':20261124',':20261126').replace('STATUS:CONFIRMED','RECURRENCE-ID;RANGE=THISANDFUTURE:20261124\r\nSTATUS:CONFIRMED')),scope)).toThrow('recurrence_expansion');
 });
 it('cancellation and recurrence instance are normalized separately',()=>{
  const e=event('repeat',';TZID=Europe/Berlin:20261124T120000',';TZID=Europe/Berlin:20261124T140000')
   .replace('STATUS:CONFIRMED','RECURRENCE-ID;TZID=Europe/Berlin:20261123T120000\r\nSTATUS:CANCELLED');
  expect(parseIcal676(ics(e),scope)[0]).toMatchObject({cancelled:true,recurrenceId:'2026-11-23T11:00:00.000Z'});
 });
 it('invalid date, missing UID, invalid account denied',()=>{
  expect(()=>parseIcal676(ics(event('bad',':20260230',':20260302')),scope)).toThrow('ical_invalid_datetime');
  expect(()=>parseIcal676(ics(event('bad',':20261124',':20261126').replace('UID:bad\r\n','')),scope)).toThrow('ical_uid_required');
  expect(()=>parseIcal676(ics(event('ok',':20261124',':20261126')),{...scope,accountId:'invalid'})).toThrow('scope_denied');
 });
 it('HMAC webhook enforces exact body, expiry, revision and offset',()=>{
  const raw=JSON.stringify({reservation_id:'OTA-1',status:'confirmed',revision:9,check_in:'2026-11-25T15:00:00+03:00',check_out:'2026-11-27T11:00:00+03:00'});
  const stamp='1795132800', secret='0123456789abcdef0123456789abcdef';
  const sig='sha256='+createHmac('sha256',secret).update(stamp+'.'+raw).digest('hex');
  verifyIngressSignature676(raw,stamp,sig,secret,1795132800000);
  expect(parseOtaWebhook676(raw,scope)[0]).toMatchObject({externalId:'OTA-1',startAt:'2026-11-25T12:00:00.000Z',sequence:9});
  expect(()=>verifyIngressSignature676(raw,stamp,sig,secret,1795133101000)).toThrow('signature_denied');
  expect(()=>verifyIngressSignature676(raw+' ',stamp,sig,secret,1795132800000)).toThrow('signature_denied');
  expect(()=>parseOtaWebhook676(JSON.stringify({reservation_id:'z',status:'confirmed',revision:1,check_in:'2026-11-25T15:00:00',check_out:'2026-11-26T16:00:00'}),scope)).toThrow('timezone_required');
 });
 it('ingests then deduplicates replay and DLQs failed persistence',async()=>{
  const seen=new Set<string>(),deadLetter=vi.fn(async()=>{});
  const store:IngressStore676={apply:async e=>{if(e.externalId==='fail')throw Error('db');if(seen.has(e.eventHash))return 'replayed';seen.add(e.eventHash);return 'accepted';},deadLetter};
  const rows=parseIcal676(ics(event('ok',':20261124',':20261126')+'\r\n'+event('fail',':20261224',':20261226')),scope);
  expect(await importInbound676(rows,store)).toMatchObject({accepted:1,deadLetters:1});
  expect((await importInbound676([rows[0]],store)).replayed).toBe(1);
  expect(deadLetter).toHaveBeenCalledWith(expect.objectContaining({code:'INGRESS_PERSIST_FAILED'}));
 });
 it('advances a source cursor only after all rows persist',async()=>{
  const commitCursor=vi.fn(async()=>{});
  const store:IngressStore676={apply:async()=> 'accepted',deadLetter:async()=>{},commitCursor};
  const rows=parseIcal676(ics(event('cursor',':20261124',':20261126')),scope);
  await importInbound676(rows,store,'etag:abcd');
  expect(commitCursor).toHaveBeenCalledWith(expect.objectContaining({cursor:'etag:abcd'}));
  const broken:IngressStore676={apply:async()=>{throw Error('db');},deadLetter:async()=>{},commitCursor};
  commitCursor.mockClear();
  await importInbound676(rows,broken,'etag:bad');
  expect(commitCursor).not.toHaveBeenCalled();
 });
 it('records provider 429 outage to DLQ, never commits a cursor',async()=>{
  const deadLetter=vi.fn(async()=>{}),commitCursor=vi.fn(async()=>{});
  const store:IngressStore676={apply:async()=> 'accepted',deadLetter,commitCursor};
  await expect(pollIcalFeed676({url:'https://calendar.example.invalid/feed.ics',
    allowHostname:'calendar.example.invalid',scope,cursor:'p:2'},store,
    async()=>new Response('',{status:429}))).rejects.toThrow('ical_feed_retryable_dlq');
  expect(deadLetter).toHaveBeenCalledWith(expect.objectContaining({code:'ICAL_FEED_READ_FAILED'}));
  expect(commitCursor).not.toHaveBeenCalled();
 });
 it('host-pinned HTTPS only and 429/401 fail closed',async()=>{
  const fetcher=vi.fn(async()=>new Response(ics(event('ok',':20261124',':20261126')),{status:200}));
  expect(await fetchConfiguredIcal676('https://calendar.example.invalid/feed.ics','calendar.example.invalid',fetcher as typeof fetch)).toContain('BEGIN:VCALENDAR');
  expect(fetcher).toHaveBeenCalledOnce();
  await expect(fetchConfiguredIcal676('http://127.0.0.1/','calendar.example.invalid',fetcher as typeof fetch)).rejects.toThrow('not_allowlisted');
  await expect(fetchConfiguredIcal676('https://evil.invalid/','calendar.example.invalid',fetcher as typeof fetch)).rejects.toThrow('not_allowlisted');
  await expect(fetchConfiguredIcal676('https://calendar.example.invalid/feed','calendar.example.invalid',async()=>new Response('',{status:429}))).rejects.toThrow('retryable');
 });
});
