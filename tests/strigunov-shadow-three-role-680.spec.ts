import { test, expect } from '@playwright/test';
import { sealData } from 'iron-session';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const BASE='http://127.0.0.1:3002';
const BUILD='SVvobnGRZ3HxpK1rDXqqS';
const SHA='d1c933bd01ce4ec84ca68e0dc0c01fd2646abb8a';
const ACCOUNT='00000000-0000-4000-8000-000000006801';
const OTHER_ACCOUNT='00000000-0000-4000-8000-000000006802';
const PROPERTY='00000000-0000-4000-8000-000000006821';
const OTHER_PROPERTY='00000000-0000-4000-8000-000000006822';
const EXTRA_PROPERTY='00000000-0000-4000-8000-000000006823';
const BOOKING='00000000-0000-4000-8000-000000006831';
const OTHER_BOOKING='00000000-0000-4000-8000-000000006832';
const WORKER_TASK='00000000-0000-4000-8000-000000006851';
const MANAGER_TASK='00000000-0000-4000-8000-000000006853';
const OTHER_USER='00000000-0000-4000-8000-000000006814';
const actors=[
 {role:'owner',id:'00000000-0000-4000-8000-000000006811',email:'e2e680-owner@example.invalid',tasks:4,finance:200},
 {role:'manager',id:'00000000-0000-4000-8000-000000006812',email:'e2e680-manager@example.invalid',tasks:4,finance:403},
 {role:'operator',id:'00000000-0000-4000-8000-000000006813',email:'e2e680-worker@example.invalid',tasks:2,finance:403},
] as const;

let sessionSecret='';
let pgPid='';
let seeded=false;
const sqlValue=(s:string)=>"'"+s.replace(/'/g,"''")+"'";
const tuples=(v:string[][])=>v.map(row=>'('+row.map(sqlValue).join(',')+')').join(',');
function runSql(sql:string):string {
 try {
  return execFileSync('sudo',['-n','nsenter','-t',pgPid,'-m','-n','-u','-i','--','/usr/lib/postgresql/17/bin/psql','-X','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d','asi_shadow_migrations_test'],{
    input:sql, encoding:'utf8',timeout:30000,stdio:['pipe','pipe','pipe'],
  }).trim();
 } catch {throw new Error('shadow_fixture_query_failed');}
}
function safeEnv() {
 const config=readFileSync('/opt/asi-shadow/.env.shadow','utf8');
 const v:Record<string,string>={};
 for(const line of config.split(/\r?\n/)) {
  const pos=line.indexOf('=');
  if(pos>0 && !line.startsWith('#'))v[line.slice(0,pos)]=line.slice(pos+1).trim().replace(/^(['"])(.*)\1$/,'$2');
 }
 if(v.ASI_SYNTHETIC_NO_SEND!=='YES' ||
   v.SUPABASE_URL!=='http://asi-shadow-rest-gateway:3000' ||
   v.ASI_SHADOW_REST_URL!==v.SUPABASE_URL ||
   v.COMMUNICATION_AUTO_SEND_ENABLED!=='false' || v.YOOKASSA_ENABLED!=='false' ||
   !v.SESSION_SECRET || v.SESSION_SECRET.length<32)throw new Error('shadow_only_no_send_preflight_failed');
 return v.SESSION_SECRET;
}
function noResidue() {
 expect(runSql("SELECT (SELECT count(*) FROM public.users WHERE email LIKE 'e2e680-%@example.invalid')=0 AND (SELECT count(*) FROM public.accounts WHERE id IN ('"+ACCOUNT+"','"+OTHER_ACCOUNT+"'))=0 AND (SELECT count(*) FROM public.ops_tasks WHERE id::text LIKE '00000000-0000-4000-8000-00000000685_')=0")).toBe('t');
}
const cleanup=[
 'BEGIN',
 "DELETE FROM public.owner_payout_reports WHERE booking_id IN ("+sqlValue(BOOKING)+','+sqlValue(OTHER_BOOKING)+')',
 "DELETE FROM public.ops_tasks WHERE id::text LIKE '00000000-0000-4000-8000-00000000685_'",
 'DELETE FROM public.booking_ops_records WHERE id IN ('+sqlValue(BOOKING)+','+sqlValue(OTHER_BOOKING)+')',
 'DELETE FROM public.property_access_grants WHERE account_id IN ('+sqlValue(ACCOUNT)+','+sqlValue(OTHER_ACCOUNT)+')',
 'DELETE FROM public.account_members WHERE account_id IN ('+sqlValue(ACCOUNT)+','+sqlValue(OTHER_ACCOUNT)+')',
 'DELETE FROM public.properties WHERE id IN ('+[PROPERTY,OTHER_PROPERTY,EXTRA_PROPERTY].map(sqlValue).join(',')+')',
 'DELETE FROM public.users WHERE id IN ('+[...actors.map(a=>a.id),OTHER_USER].map(sqlValue).join(',')+')',
 'DELETE FROM public.accounts WHERE id IN ('+[ACCOUNT,OTHER_ACCOUNT].map(sqlValue).join(',')+')',
 'COMMIT',
].join(';\n')+';';

function seed() {
 const fixture=[
  'BEGIN',
  'INSERT INTO public.accounts(id,name) VALUES '+tuples([[ACCOUNT,'E2E680 A'],[OTHER_ACCOUNT,'E2E680 B']]),
  'INSERT INTO public.users(id,email,password_hash) VALUES '+tuples([...actors.map(a=>[a.id,a.email,'synthetic-no-login']),[OTHER_USER,'e2e680-other@example.invalid','synthetic-no-login']]),
  'INSERT INTO public.account_members(account_id,user_id,role) VALUES '+tuples(actors.map(a=>[ACCOUNT,a.id,a.role]).concat([[OTHER_ACCOUNT,OTHER_USER,'owner']])),
  'INSERT INTO public.properties(id,account_id,name) VALUES '+tuples([[PROPERTY,ACCOUNT,'E2E680 property A'],[OTHER_PROPERTY,OTHER_ACCOUNT,'E2E680 property B'],[EXTRA_PROPERTY,ACCOUNT,'E2E680 extra property']]),
  'INSERT INTO public.property_access_grants(account_id,property_id,user_id,role) VALUES '+tuples(actors.map(a=>[ACCOUNT,PROPERTY,a.id,a.role]).concat([[OTHER_ACCOUNT,OTHER_PROPERTY,OTHER_USER,'owner']])),
  'INSERT INTO public.ops_tasks(id,property_id,task_type,work_kind,title,assigned_to) VALUES '+tuples([
    [WORKER_TASK,PROPERTY,'turnover','cleaning','E2E680 cleaning',actors[2].id],
    ['00000000-0000-4000-8000-000000006852',PROPERTY,'turnover','linen','E2E680 linen',actors[2].id],
    [MANAGER_TASK,PROPERTY,'turnover','supplies','E2E680 supplies',actors[1].id],
    ['00000000-0000-4000-8000-000000006854',PROPERTY,'turnover','inspection','E2E680 inspection',actors[0].id],
    ['00000000-0000-4000-8000-000000006855',OTHER_PROPERTY,'turnover','cleaning','E2E680 other tenant',OTHER_USER],
    ['00000000-0000-4000-8000-000000006856',EXTRA_PROPERTY,'turnover','cleaning','E2E680 ungranted',actors[2].id],
  ]),
  'INSERT INTO public.booking_ops_records(id,account_id,property_id,booking_id,asi_reference) VALUES '+tuples([[BOOKING,ACCOUNT,PROPERTY,'E2E680-A1','E2E680-A1'],[OTHER_BOOKING,OTHER_ACCOUNT,OTHER_PROPERTY,'E2E680-B1','E2E680-B1']]),
  'INSERT INTO public.owner_payout_reports(booking_id,account_id,property_id,currency,gross_revenue_cents,deposit_hold_cents,deposit_retained_cents,management_commission_cents,operational_expenses_cents,owner_payout_cents) VALUES '+tuples([[BOOKING,ACCOUNT,PROPERTY,'RUB','10000','0','0','1000','0','9000'],[OTHER_BOOKING,OTHER_ACCOUNT,OTHER_PROPERTY,'RUB','10000','0','0','1000','0','9000']]),
  'COMMIT'
 ].join(';\n')+';';
 runSql(fixture);
 seeded=true;
}

test.use({baseURL:BASE,screenshot:'off',trace:'off',video:'off'});
test.describe.configure({mode:'serial'});
test.beforeAll(({}, info)=>{
 test.skip(info.project.name!=='desktop' || !process.env.ASI_SHADOW_E2E_URL,'Opt-in isolated shadow desktop only');
 if(process.platform!=='linux' || process.env.ASI_SHADOW_E2E_DB!=='asi_shadow_migrations_test' ||
 process.env.ASI_SHADOW_E2E_URL!==BASE || process.env.ASI_SHADOW_E2E_NO_SEND!=='YES')
  throw new Error('shadow_vps_only');
 sessionSecret=safeEnv();
 pgPid=execFileSync('pgrep',['-x','postgres'],{encoding:'utf8'}).trim().split(/\r?\n/)[0];
 if(!/^\d+$/.test(pgPid))throw new Error('shadow_pg_missing');
 expect(runSql("SELECT current_database() || '|' || current_setting('server_version_num')")).toBe('asi_shadow_migrations_test|170011');
 expect(runSql("SELECT has_table_privilege('service_role','public.property_access_grants','SELECT')")).toBe('t');
 expect(runSql("SELECT has_table_privilege('service_role','public.property_access_grants','UPDATE')")).toBe('f');
 noResidue();
 seed();
});
test.afterAll(()=>{
 try{if(seeded){runSql(cleanup);seeded=false;noResidue();}}finally{sessionSecret='';}
});
test('new build identity and no anonymous access',async({request})=>{
 expect((await request.get('/_next/static/'+BUILD+'/_buildManifest.js')).status()).toBe(200);
 expect((await request.get('/api/health')).status()).toBe(200);
 const version=await request.get('/api/version');
 expect(version.status()).toBe(200);
 expect((await version.json()).sha).toBe(SHA);
 expect((await request.get('/api/dashboard/property-tasks?accountId='+ACCOUNT+'&propertyId='+PROPERTY)).status()).toBe(401);
});
for(const actor of actors){
 test(actor.role+' sealed session, tasks and finance scope',async({context,page})=>{
  const value=await sealData({userId:actor.id,email:actor.email},{password:sessionSecret,ttl:600});
  await context.addCookies([{name:'asi_session',value,url:BASE,httpOnly:true,secure:false,sameSite:'Lax',expires:Math.floor(Date.now()/1000)+600}]);
  await page.goto('/dashboard/booking-ops',{waitUntil:'domcontentloaded'});
  const query=new URLSearchParams({accountId:ACCOUNT,propertyId:PROPERTY});
  const r=await page.request.get('/api/dashboard/property-tasks?'+query);
  expect(r.status(),actor.role+' tasks').toBe(200);
  const data=await r.json() as {ok:boolean;tasks:Array<{id:string;property_id:string;assigned_to:string}>};
  expect(data.ok).toBe(true);
  expect(data.tasks).toHaveLength(actor.tasks);
  expect(data.tasks.every(t=>t.property_id===PROPERTY)).toBe(true);
  if(actor.role==='operator'){
   expect(data.tasks.map(t=>t.id).sort()).toEqual([WORKER_TASK,'00000000-0000-4000-8000-000000006852'].sort());
   expect(data.tasks.every(t=>t.assigned_to===actor.id)).toBe(true);
  }
  const f=new URLSearchParams({accountId:ACCOUNT,propertyId:PROPERTY,bookingOpsRecordId:BOOKING});
  const finance=await page.request.get('/api/dashboard/owner-payout-report?'+f);
  expect(finance.status(),actor.role+' finances').toBe(actor.finance);
  if(actor.role==='owner'){
   expect((await finance.json()).ok).toBe(true);
   const foreign=new URLSearchParams({accountId:OTHER_ACCOUNT,propertyId:OTHER_PROPERTY,bookingOpsRecordId:OTHER_BOOKING});
   expect((await page.request.get('/api/dashboard/owner-payout-report?'+foreign)).status()).toBe(403);
  }
  if(actor.role==='operator'){
   expect([403,404]).toContain((await page.request.patch('/api/dashboard/property-tasks?'+query+'&taskId='+MANAGER_TASK)).status());
   const close=await page.request.patch('/api/dashboard/property-tasks?'+query+'&taskId='+WORKER_TASK);
   expect(close.status()).toBe(200);
   expect((await close.json()).task.task_status).toBe('resolved');
  }
 });
}
