import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Only the existing disposable PostgreSQL CI service is permitted.
const ci = process.env.ASI_REQUIRE_DISPOSABLE_PG === '1';
const address = process.env.ASI_DISPOSABLE_POSTGRES_URL || '';
const isolated = (() => {
  try {
    const u=new URL(address);
    return ['postgresql:','postgres:'].includes(u.protocol)
      && ['localhost','127.0.0.1'].includes(u.hostname)
      && u.port==='5432' && u.pathname==='/asi_recovery_test'
      && Boolean(u.username) && !u.search && !u.hash;
  } catch { return false; }
})();
describe('G2 fixture real PostgreSQL SQL and tenant-isolation integration', () => {
 it('fails closed if CI requires disposable Postgres and it is unavailable',()=>{
   if(ci||address) expect(isolated,'never use shared/staging/production DB').toBe(true);
 });
 it('runs real RPC against temporary schema and always rolls back',async()=>{
   if(!isolated){expect(ci).toBe(false);return;}
   const {Client}=await import('pg');
   const db=new Client({connectionString:address,connectionTimeoutMillis:5000});
   await db.connect();
   let open=false,rolledBack=false;
   const rec=randomUUID(),account=randomUUID(),property=randomUUID();
   const foreign=randomUUID(),live=randomUUID(),other=randomUUID();
   const run=(s:string,args?:unknown[])=>db.query(s,args);
   const call='SELECT public.asi_mark_acceptance_fixture($1::uuid,$2::text,$3::text,$4::text,$5::uuid,$6::uuid,$7::uuid) AS result';
   const reject=async(args:unknown[],message:string)=>{
     await run('SAVEPOINT negative_fixture_case');
     try{await expect(run(call,args)).rejects.toThrow(message);}
     finally{
       await run('ROLLBACK TO SAVEPOINT negative_fixture_case');
       await run('RELEASE SAVEPOINT negative_fixture_case');
     }
   };
   try{
     await run('BEGIN');open=true;
     await run(`DO $r$ BEGIN
       IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
       IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
       IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
     END $r$`);
     await run(`CREATE TABLE public.booking_ops_records (
       id uuid PRIMARY KEY,account_id text NOT NULL,property_id text NOT NULL,
       booking_id text,guest_name text,guest_phone text,guest_email text,
       guest_telegram text,ota_source text NOT NULL DEFAULT 'manual',
       ops_status text NOT NULL DEFAULT 'created',
       documents_status text NOT NULL DEFAULT 'not_started',
       contract_status text NOT NULL DEFAULT 'not_started',
       checkin_readiness_status text NOT NULL DEFAULT 'not_started',
       reservation_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
       updated_at timestamptz NOT NULL DEFAULT now())`);
     await run(`CREATE TABLE public.booking_ops_events (
       booking_ops_record_id uuid REFERENCES public.booking_ops_records(id),
       event_type text,title text,description text,actor_type text,
       metadata jsonb NOT NULL DEFAULT '{}'::jsonb,dedupe_key text)`);
     await run(`CREATE UNIQUE INDEX idx_booking_ops_events_dedupe
       ON public.booking_ops_events(booking_ops_record_id,dedupe_key)
       WHERE dedupe_key IS NOT NULL`);
     await run("CREATE FUNCTION public.asi_mark_acceptance_fixture(uuid,text,text,text) RETURNS boolean LANGUAGE sql AS 'SELECT false'");
     await run(`INSERT INTO public.booking_ops_records(id,account_id,property_id,guest_name)
       VALUES($1,$2,$3,'ASI SYNTHETIC ACCEPTANCE FIXTURE'),
             ($4,$5,$3,'ASI SYNTHETIC ACCEPTANCE FIXTURE'),
             ($6,$2,$3,'Real contactable guest')`,[rec,account,property,foreign,other,live]);
     await run("SET LOCAL asi.acceptance_fixture_migration_authorized = 'YES'");
     const src=readFileSync(resolve(process.cwd(),'scripts/acceptance/sql/asi-acceptance-fixture-candidate.sql'),'utf8');
     expect((src.match(/(^|\n)BEGIN;\n/g) || []).length).toBe(1);
     expect((src.match(/(^|\n)COMMIT;\s*$/g) || []).length).toBe(1);
     // Remove only outer transaction delimiters; entire DDL stays rollbackable.
     const inner=src.replace(/(^|\n)BEGIN;\n/,'\n').replace(/\nCOMMIT;\s*$/,'\n');
     await run(inner);
     const signature='public.asi_mark_acceptance_fixture(uuid,text,text,text,uuid,uuid,uuid)';
     const acl=await run(`SELECT
       to_regprocedure('public.asi_mark_acceptance_fixture(uuid,text,text,text)') IS NULL AS old_gone,
       has_function_privilege('anon',$1::text,'EXECUTE') AS anon,
       has_function_privilege('authenticated',$1::text,'EXECUTE') AS auth,
       has_function_privilege('service_role',$1::text,'EXECUTE') AS service`,[signature]);
     expect(acl.rows[0]).toMatchObject({old_gone:true,anon:false,auth:false,service:true});
     const args=[rec,account,property,'actor',rec,account,property];
     // The migration owner (postgres) must NOT be allowed to invoke the RPC.
     await reject(args,'FORBIDDEN_ROLE');
     await run('GRANT SELECT,UPDATE ON public.booking_ops_records TO service_role');
     await run('GRANT SELECT,INSERT ON public.booking_ops_events TO service_role');
     await run('SET LOCAL ROLE service_role');
     expect((await run(call,args)).rows[0].result).toBe(true);
     expect((await run(call,args)).rows[0].result).toBe(true);
     await reject([rec,other,property,'actor',rec,other,property],'fixture_tenant_scope_not_found');
     await reject([live,account,property,'actor',live,account,property],'fixture_provenance_not_verified');
     await reject([foreign,other,property,'actor',rec,other,property],'fixture_record_not_owner_pinned');
     expect((await run('SELECT count(*)::int AS n FROM public.booking_ops_events')).rows[0].n).toBe(1);
     await run('RESET ROLE');
     await run('ROLLBACK');open=false;rolledBack=true;
     expect((await run('SELECT to_regprocedure($1::text) IS NULL AS absent',[signature])).rows[0].absent).toBe(true);
     console.log('ASI_FIXTURE_PG_PROOF '+JSON.stringify({
       realRpc:true,wrongTenantDenied:true,nonsyntheticDenied:true,
       wrongRecordDenied:true,postgresDenied:true,oneAuditOnly:true,oldOverloadReplaced:true,
       noPublicExecute:true,rollback:true,sharedDbTouched:false,
     }));
   }finally{
     if(open){await db.query('ROLLBACK');rolledBack=true;}
     await db.end();
     if(!rolledBack)throw new Error('PostgreSQL transaction not rolled back');
   }
 },45000);
});
