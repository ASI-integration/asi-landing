import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export type IncomingReservation676 = {
  accountId: string; propertyId: string; sourceId: string; externalId: string;
  recurrenceId: string; startAt: string | null; endAt: string | null;
  sequence: number; cancelled: boolean; eventHash: string;
};
export type IngressDisposition676 = 'accepted'|'replayed'|'stale'|'cancelled'|'conflict_review';
export type IngressStore676 = {
  apply(event: IncomingReservation676): Promise<IngressDisposition676>;
  deadLetter(input: { accountId: string; propertyId: string; sourceId: string; key: string; code: string }): Promise<void>;
  commitCursor?(input:{accountId:string;propertyId:string;sourceId:string;cursor:string}):Promise<void>;
};
export type IngressResult676 = { accepted: number; replayed: number; stale: number; cancelled: number; conflicts: number; deadLetters: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function assertIngressScope676(scope: {accountId: string; propertyId: string; sourceId: string}) {
  if (!UUID.test(scope.accountId) || !UUID.test(scope.propertyId) || !/^[a-zA-Z0-9_-]{2,64}$/.test(scope.sourceId)) {
    throw new Error('ingress_scope_denied');
  }
}
function eventHash(event: Omit<IncomingReservation676,'eventHash'>): string {
  return createHash('sha256').update(JSON.stringify(event)).digest('hex');
}
function parseIcalInstant(value: string, timezone: string | null): string {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value);
  if (!m) throw new Error('ical_invalid_datetime');
  const [,ys,ms,ds,hs='00',mins='00',ss='00',z] = m;
  const y=Number(ys),mo=Number(ms),day=Number(ds),hour=Number(hs),minute=Number(mins),second=Number(ss);
  if (y<1970 || y>2100 || mo<1 || mo>12 || day<1 || day>31 || hour>23 || minute>59 || second>59) {
    throw new Error('ical_invalid_datetime');
  }
  const raw=Date.UTC(y,mo-1,day,hour,minute,second);
  const roundTrip=new Date(raw);
  if(roundTrip.getUTCFullYear()!==y || roundTrip.getUTCMonth()+1!==mo || roundTrip.getUTCDate()!==day) {
    throw new Error('ical_invalid_datetime');
  }
  if(!m[4] || z) return new Date(raw).toISOString(); // DATE all-day, or UTC form
  if(!timezone) throw new Error('ical_floating_timezone_not_configured');
  let formatter: Intl.DateTimeFormat;
  try {
    formatter=new Intl.DateTimeFormat('en-US',{
      timeZone:timezone, year:'numeric',month:'2-digit',day:'2-digit',
      hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',
    });
  } catch {throw new Error('ical_unknown_timezone');}
  const parts=(timestamp:number) => {
    const p=Object.fromEntries(formatter.formatToParts(new Date(timestamp))
      .filter(x=>x.type!=='literal').map(x=>[x.type,Number(x.value)]));
    return [p.year,p.month,p.day,p.hour,p.minute,p.second] as const;
  };
  const offset=(timestamp:number) => {
    const [a,b,c,d,e,f]=parts(timestamp);
    return Date.UTC(a,b-1,c,d,e,f)-timestamp;
  };
  const matches:number[]=[];
  const offsets=new Set([offset(raw),offset(raw-86400000),offset(raw+86400000)]);
  for(const off of offsets) {
    const guess=raw-off;
    if(parts(guess).join(',')===[y,mo,day,hour,minute,second].join(',')) matches.push(guess);
  }
  if(!matches.length) throw new Error('ical_dst_gap');
  return new Date(Math.min(...matches)).toISOString();
}
function prop(line:string): {name:string;value:string;tz:string|null} {
  const i=line.indexOf(':');
  if(i<0 || i>180) throw new Error('ical_invalid_property');
  const [name,...params]=line.slice(0,i).split(';');
  if(params.some(p=>p.toUpperCase().startsWith('RANGE='))) throw new Error('ical_recurrence_expansion_not_supported');
  const tz=params.find(p=>p.toUpperCase().startsWith('TZID='))?.slice(5).replace(/^"|"$/g,'') ?? null;
  return {name:name.toUpperCase(),value:line.slice(i+1),tz};
}
export function parseIcal676(
  calendar:string,
  scope:{accountId:string;propertyId:string;sourceId:string;defaultTimezone?:string}
):IncomingReservation676[] {
  assertIngressScope676(scope);
  if(Buffer.byteLength(calendar,'utf8')>512_000) throw new Error('ical_size_limit');
  const unfolded=calendar.replace(/\r?\n[ \t]/g,'').replace(/\r\n/g,'\n').split('\n');
  if(unfolded.some(x=>x.length>4096)) throw new Error('ical_line_limit');
  if(!unfolded.some(x=>x.trim()==='BEGIN:VCALENDAR')) throw new Error('ical_calendar_required');
  const result:IncomingReservation676[]=[];
  let fields:Record<string,{value:string;tz:string|null}>|null=null;
  for(const raw of unfolded) {
    const line=raw.trim();
    if(line==='BEGIN:VEVENT') {if(fields) throw new Error('ical_nested_event');fields={};continue;}
    if(line==='END:VEVENT') {
      if(!fields) throw new Error('ical_unmatched_event');
      if(result.length>=500) throw new Error('ical_event_limit');
      if(fields.RRULE || fields.RDATE || fields.EXDATE || fields['RECURRENCE-ID']?.value.includes('RANGE=')) {
        throw new Error('ical_recurrence_expansion_not_supported');
      }
      const uid=fields.UID?.value.trim();
      if(!uid || uid.length>190) throw new Error('ical_uid_required');
      const sequence=fields.SEQUENCE ? Number(fields.SEQUENCE.value) : 0;
      if(!Number.isSafeInteger(sequence)||sequence<0) throw new Error('ical_invalid_sequence');
      const cancelled=fields.STATUS?.value.toUpperCase()==='CANCELLED';
      const timezone=fields.DTSTART?.tz || scope.defaultTimezone || null;
      const start=fields.DTSTART?parseIcalInstant(fields.DTSTART.value,timezone):null;
      const end=fields.DTEND?parseIcalInstant(fields.DTEND.value,fields.DTEND.tz || timezone):null;
      if(!cancelled && (!start || !end || Date.parse(start)>=Date.parse(end))) throw new Error('ical_invalid_stay_range');
      const recurrence=fields['RECURRENCE-ID'];
      const recurrenceId=recurrence ? parseIcalInstant(recurrence.value,recurrence.tz||timezone) : '';
      const plain={
        accountId:scope.accountId,propertyId:scope.propertyId,sourceId:scope.sourceId,
        externalId:uid,recurrenceId,startAt:start,endAt:end,sequence,cancelled,
      };
      result.push({...plain,eventHash:eventHash(plain)});
      fields=null;
      continue;
    }
    if(fields && line && !line.startsWith('BEGIN:') && !line.startsWith('END:')) {
      const p=prop(line);
      if(['UID','DTSTART','DTEND','STATUS','SEQUENCE','RECURRENCE-ID','RRULE','RDATE','EXDATE'].includes(p.name)) {
        if(fields[p.name]) throw new Error('ical_duplicate_property');
        fields[p.name]={value:p.value,tz:p.tz};
      }
    }
  }
  if(fields) throw new Error('ical_unclosed_event');
  return result;
}
export function verifyIngressSignature676(
  raw:string, timestamp:string|null, signature:string|null, secret:string, nowMs=Date.now()
):void {
  if(secret.length<32 || !timestamp || !/^\d{10}$/.test(timestamp) ||
    Math.abs(nowMs-Number(timestamp)*1000)>300_000 ||
    !signature || !/^sha256=[a-f0-9]{64}$/.test(signature) ||
    Buffer.byteLength(raw,'utf8')>512_000) throw new Error('ingress_signature_denied');
  const expected=createHmac('sha256',secret).update(timestamp+'.'+raw).digest();
  if(!timingSafeEqual(expected,Buffer.from(signature.slice(7),'hex'))) throw new Error('ingress_signature_denied');
}
export function parseOtaWebhook676(
  raw:string,scope:{accountId:string;propertyId:string;sourceId:string},
):IncomingReservation676[] {
  assertIngressScope676(scope);
  let data:unknown;
  try {data=JSON.parse(raw);}catch{throw new Error('ota_invalid_json');}
  if(!data || typeof data!=='object'||Array.isArray(data)) throw new Error('ota_invalid_payload');
  const x=data as Record<string,unknown>;
  const externalId=x.reservation_id;
  const status=x.status;
  if(typeof externalId!=='string'||externalId.length>190||!externalId ||
    typeof status!=='string'|| !['confirmed','modified','cancelled'].includes(status)) throw new Error('ota_invalid_payload');
  const sequence=Number(x.revision);
  if(!Number.isSafeInteger(sequence)||sequence<0) throw new Error('ota_invalid_revision');
  const cancelled=status==='cancelled';
  const iso=(v:unknown)=> {
    if(typeof v!=='string'||!(/Z$|[+-]\d{2}:\d{2}$/.test(v))||!Number.isFinite(Date.parse(v))) throw new Error('ota_timezone_required');
    return new Date(v).toISOString();
  };
  const start=x.check_in == null ? null : iso(x.check_in);
  const end=x.check_out == null ? null : iso(x.check_out);
  if(!cancelled && (!start||!end||Date.parse(start)>=Date.parse(end))) throw new Error('ota_invalid_stay_range');
  const plain={...scope,externalId,recurrenceId:'',startAt:start,endAt:end,sequence,cancelled};
  return [{...plain,eventHash:eventHash(plain)}];
}
export async function importInbound676(
 events:IncomingReservation676[], store:IngressStore676, cursor?:string,
):Promise<IngressResult676> {
  const stats:IngressResult676={accepted:0,replayed:0,stale:0,cancelled:0,conflicts:0,deadLetters:0};
  if(events.length>500) throw new Error('ingress_event_limit');
  for(const event of events) {
    try {
      const outcome=await store.apply(event);
      if(outcome==='accepted')stats.accepted++;
      else if(outcome==='replayed')stats.replayed++;
      else if(outcome==='stale')stats.stale++;
      else if(outcome==='cancelled')stats.cancelled++;
      else if(outcome==='conflict_review')stats.conflicts++;
    } catch {
      await store.deadLetter({accountId:event.accountId,propertyId:event.propertyId,sourceId:event.sourceId,key:event.eventHash,code:'INGRESS_PERSIST_FAILED'});
      stats.deadLetters++;
    }
  }
  if(cursor && stats.deadLetters===0 && events.length>0 && store.commitCursor){
    if(cursor.length>512)throw new Error('ingress_cursor_limit');
    const first=events[0];
    await store.commitCursor({accountId:first.accountId,propertyId:first.propertyId,sourceId:first.sourceId,cursor});
  }
  return stats;
}

export async function pollIcalFeed676(input:{
 url:string;allowHostname:string;
 scope:{accountId:string;propertyId:string;sourceId:string;defaultTimezone?:string};
 cursor?:string;
},store:IngressStore676,fetcher:typeof fetch=fetch):Promise<IngressResult676> {
  assertIngressScope676(input.scope);
  try {
    const raw=await fetchConfiguredIcal676(input.url,input.allowHostname,fetcher);
    return await importInbound676(parseIcal676(raw,input.scope),store,input.cursor);
  } catch {
    const key=createHash('sha256').update(input.scope.accountId+'|'+input.scope.propertyId+'|'+input.scope.sourceId+'|'+input.url).digest('hex');
    await store.deadLetter({accountId:input.scope.accountId,propertyId:input.scope.propertyId,sourceId:input.scope.sourceId,key,code:'ICAL_FEED_READ_FAILED'});
    throw new Error('ical_feed_retryable_dlq');
  }
}
export async function fetchConfiguredIcal676(url:string,allowHostname:string,fetcher:typeof fetch=fetch):Promise<string> {
  let u:URL;
  try {u=new URL(url);}catch{throw new Error('ical_url_invalid');}
  if(u.protocol!=='https:' || u.hostname!==allowHostname || u.username||u.password||u.port) throw new Error('ical_url_not_allowlisted');
  const r=await fetcher(u.toString(),{method:'GET',redirect:'error',signal:AbortSignal.timeout(8000),headers:{Accept:'text/calendar'}});
  if(r.status===401||r.status===403) throw new Error('ical_credentials_required');
  if(r.status===429||r.status>=500) throw new Error('ical_provider_retryable');
  if(!r.ok) throw new Error('ical_provider_error');
  const declared=Number(r.headers.get('content-length')??'0');
  if(declared>512_000) throw new Error('ical_size_limit');
  const body=await r.text();
  if(Buffer.byteLength(body,'utf8')>512_000) throw new Error('ical_size_limit');
  return body;
}
