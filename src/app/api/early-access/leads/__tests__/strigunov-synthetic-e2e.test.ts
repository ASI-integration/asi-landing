/**
 * Strigunov isolated synthetic journey: REAL public + operator API handlers,
 * REAL normalization/quota/CRM queue/auth logic; a PHYSICAL fsync-backed
 * temporary file substitutes for the unavailable Supabase CRM adapter.
 *
 * This is NOT a proof of production CRM, guest messaging, consent rollout,
 * Hetzner service installation or an actual end-to-end booking.
 */
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,openSync,writeSync,closeSync,fsyncSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NextResponse} from 'next/server';
import type {NormalizedCrmContactInput} from '@/lib/crm/normalize';
import type {CrmContact} from '@/lib/crm/types';
import {resetPublicPilotLeadRateLimitForTests} from '@/lib/early-access/public-lead-rate-limit';

const mock=vi.hoisted(()=>({
  create:vi.fn(),list:vi.fn(),secret:vi.fn(),session:vi.fn(),
  byContact:vi.fn(),feed:vi.fn(),booking:vi.fn(),ops:vi.fn(),
}));
vi.mock('@/lib/crm/repository',()=>({
  createCrmContact:mock.create,listCrmContacts:mock.list,
}));
vi.mock('@/lib/auth',()=>({
  isSessionSecretConfigured:mock.secret,getSession:mock.session,
}));
vi.mock('@/lib/crm/queue-events',()=>({
  listCrmEventsByContactIds:mock.byContact,
  listRecentCrmEventsForFeed:mock.feed,
}));
vi.mock('@/lib/crm/booking-signals',()=>({
  loadCrmBookingSignalsForQueue:mock.booking,
}));
vi.mock('@/lib/ops-board/repository',()=>({
  summarizeOpenOpsTasksByContactIds:mock.ops,
}));
vi.mock('@/lib/crm/demo-activity-data',()=>({
  demoCrmEventsForFeed:[],shouldUseDemoActivityEvents:()=>false,
}));

import {POST} from '../route';
import {GET} from '@/app/api/dashboard/crm/queue/route';

type StoredRow=CrmContact & {id:string};
const date='2026-10-15T06:00:00.000Z';
const valid={
  name:'Мария Орлова',contact:'@owner_simulated_71',
  objectsCount:'2-5 объектов',referral:'strigunov',consent:true,website:'',
};
let root='',file='',failure=false,missingId=false,sequence=0,readFailure=false;

function diskRows():StoredRow[]{
  const raw=readFileSync(file,'utf8');
  if(!raw)return [];
  return raw.trimEnd().split('\n').map(line=>JSON.parse(line) as StoredRow);
}
function appendRow(row:StoredRow){
  const fd=openSync(file,'a');
  try{
    const b=Buffer.from(JSON.stringify(row)+'\n','utf8');
    if(writeSync(fd,b)!==b.byteLength)throw new Error('SHORT_WRITE');
    fsyncSync(fd);
  }finally{closeSync(fd);}
}
function persist(input:NormalizedCrmContactInput):StoredRow {
  if(failure)throw new Error('isolated disk failure');
  if(missingId)return {...input,id:'',createdAt:date,updatedAt:date};
  sequence++;
  const row={...input,id:'00000000-0000-4000-8000-'+String(sequence).padStart(12,'0'),
    createdAt:date,updatedAt:date} as StoredRow;
  appendRow(row);
  return row;
}
function request(body:unknown,headers:Record<string,string>={}):Request{
  return new Request('https://isolated.invalid/api/early-access/leads',{
    method:'POST',
    headers:{'content-type':'application/json',...headers},
    body:typeof body==='string'?body:JSON.stringify(body),
  });
}
const submit=(body:unknown=valid,headers:Record<string,string>={})=>POST(request(body,headers));
const queue=(filter='all')=>GET(new Request('https://isolated.invalid/api/dashboard/crm/queue?filter='+filter));

beforeEach(()=>{
  root=mkdtempSync(join(tmpdir(),'asi-strigunov-e2e-'));
  file=join(root,'crm-synthetic.ndjson');
  writeFileSync(file,'');
  sequence=0;failure=false;missingId=false;readFailure=false;
  resetPublicPilotLeadRateLimitForTests();
  for(const fn of Object.values(mock))fn.mockReset();
  mock.create.mockImplementation(async (input:NormalizedCrmContactInput)=>persist(input));
  mock.list.mockImplementation(async ()=>{
    if(readFailure)throw new Error('isolated readback failure');
    // A fresh filesystem read is performed for every operator request.
    return diskRows().filter(row=>!row.crmArchived);
  });
  mock.secret.mockReturnValue(true);
  mock.session.mockResolvedValue({userId:'isolated-operator-1',email:'operator@asi-global.ru'});
  mock.byContact.mockResolvedValue({});
  mock.feed.mockResolvedValue([]);
  mock.booking.mockResolvedValue([]);
  mock.ops.mockResolvedValue({});
});
afterEach(()=>{
  if(root)rmSync(root,{recursive:true,force:true});
  resetPublicPilotLeadRateLimitForTests();
  vi.clearAllMocks();
});

describe('Strigunov synthetic public intake → fsync store → real operator CRM queue',()=>{
  it('submits a referral lead and verifies a physically reopened CRM row',async()=>{
    const res=await submit();
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ok:true});
    const rows=diskRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name:valid.name,telegramUsername:'owner_simulated_71',objectsCount:2,
      role:'owner',source:'form',status:'new',
      communicationStatus:'needs_manual_reaction',
    });
    expect(rows[0].note).toContain('Стригунов');
    expect(rows[0].note).not.toMatch(/пароль|password/i);
  });

  it('shows the SAME stored lead in the actual authenticated CRM operator route',async()=>{
    expect((await submit()).status).toBe(201);
    const res=await queue('needs_operator');
    expect(res.status).toBe(200);
    const body=await res.json();
    expect(body.ok).toBe(true);
    expect(body.operatorInbox).toHaveLength(1);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe(diskRows()[0].id);
    expect(body.items[0].needsOperator).toBe(true);
    expect(body.items[0].column).toBe('needs_operator');
    expect(body.metrics.needsAttention).toBe(1);
    expect(mock.booking).toHaveBeenCalledOnce();
  });

  it('anonymous responses never expose CRM ids, contacts or operator events',async()=>{
    const res=await submit();
    const text=await res.text();
    expect(text).not.toContain(valid.contact);
    expect(text).not.toContain(diskRows()[0].id);
    expect(text).not.toContain(valid.name);
    expect(text).toBe('{"ok":true}');
  });

  it('an unauthenticated client cannot inspect the operator queue',async()=>{
    await submit();
    mock.session.mockResolvedValue({userId:'',email:''});
    const res=await queue();
    expect(res.status).toBe(401);
    expect(mock.list).not.toHaveBeenCalled();
  });

  it('operator queue is unavailable with no session-secret configuration',async()=>{
    await submit();
    mock.secret.mockReturnValue(false);
    expect((await queue()).status).toBe(401);
    expect(mock.list).not.toHaveBeenCalled();
  });

  it('a blank operator email is refused without reading CRM',async()=>{
    await submit();
    mock.session.mockResolvedValue({userId:'synthetic',email:''});
    expect((await queue()).status).toBe(403);
    expect(mock.list).not.toHaveBeenCalled();
  });

  it('repeated public submission replays response without another disk write',async()=>{
    expect((await submit()).status).toBe(201);
    const original=readFileSync(file);
    expect((await submit()).status).toBe(200);
    expect(mock.create).toHaveBeenCalledTimes(1);
    expect(readFileSync(file)).toEqual(original);
  });

  it('simultaneous duplicate posts leave precisely one fsynced row',async()=>{
    const [a,b]=await Promise.all([submit(),submit()]);
    expect([a.status,b.status].sort()).toEqual([200,201]);
    expect(diskRows()).toHaveLength(1);
    expect(mock.create).toHaveBeenCalledOnce();
  });

  it('disk failure does not return success and retry can persist later',async()=>{
    failure=true;
    const broken=await submit();
    expect(broken.status).toBe(503);
    expect(diskRows()).toHaveLength(0);
    failure=false;
    expect((await submit()).status).toBe(201);
    expect(diskRows()).toHaveLength(1);
  });

  it('missing persisted identifier fails the public response',async()=>{
    missingId=true;
    expect((await submit()).status).toBe(503);
    expect(diskRows()).toHaveLength(0);
  });

  it('a readback failure does not fabricate operator-visible contacts',async()=>{
    await submit();
    readFailure=true;
    const res=await queue();
    expect(res.status).toBe(500);
    expect((await res.json()).ok).toBe(false);
  });

  it('operator queue excludes an archived contact read from the physical store',async()=>{
    await submit();
    const rows=diskRows();
    writeFileSync(file,JSON.stringify({...rows[0],crmArchived:true})+'\n');
    expect((await (await queue()).json()).items).toHaveLength(0);
  });

  it('operator can observe a manually updated follow-up status without any outbound send',async()=>{
    await submit();
    const [row]=diskRows();
    const updated={...row,status:'onboarding',communicationStatus:'replied',nextStep:'Оператор ответит вручную'};
    writeFileSync(file,JSON.stringify(updated)+'\n');
    const body=await (await queue()).json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].needsOperator).toBe(false);
    expect(body.items[0].column).toBe('onboarding');
  });

  it('filters out a completed card from the attention-only queue',async()=>{
    await submit();
    const [row]=diskRows();
    writeFileSync(file,JSON.stringify({...row,communicationStatus:'replied',status:'contact'})+'\n');
    const body=await (await queue('needs_operator')).json();
    expect(body.items).toHaveLength(0);
    expect(body.operatorInbox).toHaveLength(0);
  });

  it('disables automatic guest outbound by construction',async()=>{
    await submit();
    const body=await (await queue()).json();
    expect(body.bookingSignals).toEqual([]);
    expect(mock.byContact).toHaveBeenCalledOnce();
    expect(mock.feed).toHaveBeenCalledOnce();
    expect(mock.booking).toHaveBeenCalledOnce();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].messages).toHaveLength(0);
  });

  it.each([
    {kind:'missing consent',body:{...valid,consent:false}},
    {kind:'honeypot',body:{...valid,website:'spam.invalid'}},
    {kind:'missing name',body:{...valid,name:''}},
    {kind:'invalid contact',body:{...valid,contact:'not-a-contact'}},
    {kind:'invalid objects',body:{...valid,objectsCount:'999 объектов'}},
  ])('$kind is refused before a physical CRM write',async ({body})=>{
    const res=await submit(body);
    expect(res.status).toBe(400);
    expect(diskRows()).toHaveLength(0);
    expect(mock.create).not.toHaveBeenCalled();
  });

  it('referral spoof cannot create a Strigunov authorization claim',async()=>{
    expect((await submit({...valid,referral:'strigunov_admin'})).status).toBe(201);
    expect(diskRows()[0].note).not.toContain('Стригунов');
  });

  it('oversized content is rejected before persistence',async()=>{
    const res=await submit(valid,{'content-length':'9000'});
    expect(res.status).toBe(413);
    expect(diskRows()).toHaveLength(0);
  });

  it('malformed JSON is a controlled refusal',async()=>{
    expect((await submit('{bad')).status).toBe(400);
    expect(diskRows()).toHaveLength(0);
  });

  it('spoofed IP headers do not bypass the per-contact quota',async()=>{
    for(let i=0;i<3;i++){
      expect((await submit({...valid,name:'Владелец '+i},{'x-real-ip':'203.0.113.'+(10+i)})).status).toBe(201);
    }
    const blocked=await submit({...valid,name:'Владелец 3'},{'x-forwarded-for':'198.51.100.1'});
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBeTruthy();
    expect(diskRows()).toHaveLength(3);
  });
});
