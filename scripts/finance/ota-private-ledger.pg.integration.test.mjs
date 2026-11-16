import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';
const { Client } = pg;

const urlText = process.env.ASI_DISPOSABLE_POSTGRES_URL;
if (!urlText) throw new Error('DISPOSABLE_POSTGRES_MISSING_NO_SKIP');
const url = new URL(urlText);
if (!['localhost', '127.0.0.1'].includes(url.hostname)
  || url.port !== '5433' || url.pathname !== '/asi_ota_finance_test') {
  throw new Error('DISPOSABLE_POSTGRES_IDENTITY_MISMATCH');
}
const sql = readFileSync(
  new URL('../../docs/finance/sql/ota-finance-private-ledger-candidate.sql', import.meta.url),
  'utf8',
);
const auditSql = readFileSync(
  new URL('../../supabase/migrations/20261116153907_ota_finance_transaction_audit_v1.sql', import.meta.url),
  'utf8',
);
const A='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const U='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const digest='a'.repeat(64);

test('OTA private ledger SQL on disposable PostgreSQL 17 only', { timeout: 65000 }, async (t) => {
  const c=new Client({ connectionString:urlText, connectionTimeoutMillis:6000 });
  await c.connect();
  let setup=false;
  const query=(sql,params=[])=>c.query(sql,params);
  const denied=async(role,statement,params=[])=>{
    await query('SAVEPOINT finance_negative');
    try {
      await query('SET LOCAL ROLE '+role);
      await assert.rejects(query(statement,params));
    } finally {
      await query('ROLLBACK TO SAVEPOINT finance_negative');
      await query('RELEASE SAVEPOINT finance_negative');
    }
  };
  try {
    const server=await query('select current_setting(\'server_version_num\')::integer n,current_database() db');
    assert.equal(server.rows[0].db,'asi_ota_finance_test');
    assert.equal(Math.floor(server.rows[0].n/10000),17);
    // Never overwrite another app, prior fixture, or shared test database.
    const preflight=await query(`SELECT to_regclass('public.accounts') AS accounts,
      to_regclass('public.properties') AS properties,
      to_regclass('public.users') AS users,
      to_regclass('public.account_members') AS account_members,
      to_regclass('public.booking_ops_records') AS bookings,
      to_regclass('ota_finance_private.fee_rule_versions') AS finance`);
    assert.ok(Object.values(preflight.rows[0]).every(value=>value===null),
      'DISPOSABLE_POSTGRES_NOT_EMPTY');
    await query('BEGIN');
    for(const role of ['anon','authenticated','service_role']){
      await query('CREATE ROLE '+role+' NOLOGIN'+(role==='service_role'?' BYPASSRLS':''));
    }
    await query('CREATE TABLE public.users(id uuid primary key)');
    await query('CREATE TABLE public.accounts(id uuid primary key)');
    await query('CREATE TABLE public.properties(id uuid primary key,account_id uuid not null references public.accounts(id))');
    await query('CREATE TABLE public.account_members(account_id uuid not null references public.accounts(id),user_id uuid not null references public.users(id),role text not null)');
    await query('CREATE TABLE public.booking_ops_records(account_id text not null,property_id text not null,booking_id text not null)');
    await query('INSERT INTO public.accounts(id) VALUES ($1),($2)',[A,B]);
    await query('INSERT INTO public.users(id) VALUES ($1)',[U]);
    await query('INSERT INTO public.properties(id,account_id) VALUES ($1,$2),($3,$4)',
      ['11111111-1111-4111-8111-111111111111',A,'22222222-2222-4222-8222-222222222222',B]);
    await query('INSERT INTO public.account_members(account_id,user_id,role) VALUES($1,$2,$3)',[A,U,'owner']);
    await query('INSERT INTO public.booking_ops_records(account_id,property_id,booking_id) VALUES($1,$2,$3)',[A,'11111111-1111-4111-8111-111111111111','booking-a']);
    await query('COMMIT');
    setup=true;
    await query(sql);
    await query(auditSql);
    const schema=await query(
      "SELECT tablename,rowsecurity FROM pg_tables WHERE schemaname='ota_finance_private' ORDER BY tablename");
    assert.deepEqual(schema.rows.map(x=>x.tablename),
      ['cash_events','fee_rule_versions','operation_audit','statement_imports','statement_reviews']);
    assert.ok(schema.rows.every(x=>x.rowsecurity===true));
    assert.equal((await query("SELECT has_schema_privilege('anon','ota_finance_private','USAGE') allowed")).rows[0].allowed,false);
    assert.equal((await query("SELECT has_schema_privilege('authenticated','ota_finance_private','USAGE') allowed")).rows[0].allowed,false);
    assert.equal((await query("SELECT has_table_privilege('service_role','ota_finance_private.cash_events','UPDATE') allowed")).rows[0].allowed,false);
    assert.equal((await query("SELECT has_table_privilege('service_role','ota_finance_private.cash_events','INSERT') allowed")).rows[0].allowed,true);
    assert.equal((await query("SELECT has_table_privilege('service_role','ota_finance_private.operation_audit','INSERT') allowed")).rows[0].allowed,true);
    assert.equal((await query("SELECT has_table_privilege('service_role','ota_finance_private.operation_audit','UPDATE') allowed")).rows[0].allowed,false);
    await query('BEGIN');
    await denied('anon','select * from ota_finance_private.cash_events');
    await denied('authenticated','select * from ota_finance_private.cash_events');
    await query('COMMIT');
    const ins=await query(`INSERT INTO ota_finance_private.statement_imports
      (account_id,property_id,provider,currency,statement_external_id,source_sha256,as_of_date)
      VALUES($1,'11111111-1111-4111-8111-111111111111','ota-a','RUB','statement-a',$2,'2026-11-16')
      RETURNING id,source_status`,[A,digest]);
    assert.equal(ins.rows[0].source_status,'UNVERIFIED_OPERATOR_IMPORT');
    const statementId=ins.rows[0].id;
    await query(`INSERT INTO ota_finance_private.cash_events
      (statement_import_id,account_id,property_id,provider,currency,booking_id,
       external_event_id,kind,amount_minor,claimed_settled_on)
       VALUES($1,$2,'11111111-1111-4111-8111-111111111111','ota-a','RUB','booking-a',
       'evt-a','payout_received',84800,'2026-11-16')`,[statementId,A]);
    await query('BEGIN');
    const expectSqlError=async(statement,params)=>{
      await query('SAVEPOINT negative_insert');
      try{ await assert.rejects(query(statement,params)); }
      finally {
        await query('ROLLBACK TO SAVEPOINT negative_insert');
        await query('RELEASE SAVEPOINT negative_insert');
      }
    };
    const base=`INSERT INTO ota_finance_private.cash_events
      (statement_import_id,account_id,property_id,provider,currency,booking_id,
      external_event_id,kind,amount_minor,claimed_settled_on)
      VALUES ($1,$2,'11111111-1111-4111-8111-111111111111','ota-a','RUB',
      'booking-a',$3,'payout_received',84800,'2026-11-16')`;
    await expectSqlError(base,[statementId,B,'evt-other-tenant']);
    await expectSqlError(base,[statementId,A,'evt-a']);
    await query('COMMIT');
    // The property must belong to the exact account, even without a statement parent.
    const feeInsert=`INSERT INTO ota_finance_private.fee_rule_versions
      (account_id,property_id,provider,currency,contract_key,version,effective_from,
       effective_through,commission_bps,fixed_minor,fee_base,collection_method,
       charge_on_cancellation,source_digest_sha256)
      VALUES ($1,$2,'ota-a','RUB','c-1',$3,$4,$5,1000,0,'gross',
              'withheld_from_payout',false,$6)`;
    await query(feeInsert,[A,'11111111-1111-4111-8111-111111111111',1,'2026-01-01','2026-12-31',digest]);
    await query('BEGIN');
    const expectFinanceRejection=async(statement,params=[])=>{
      await query('SAVEPOINT finance_negative_constraint');
      try{await assert.rejects(query(statement,params));}
      finally{
        await query('ROLLBACK TO SAVEPOINT finance_negative_constraint');
        await query('RELEASE SAVEPOINT finance_negative_constraint');
      }
    };
    await expectFinanceRejection(feeInsert,
      [B,'11111111-1111-4111-8111-111111111111',2,'2027-01-01',null,digest]);
    await expectFinanceRejection(feeInsert,
      [A,'11111111-1111-4111-8111-111111111111',2,'2026-11-01','2027-03-01',digest]);
    // Imported CSV can never claim verified bank settlement.
    await expectFinanceRejection(`INSERT INTO ota_finance_private.cash_events
      (statement_import_id,account_id,property_id,provider,currency,booking_id,
       external_event_id,kind,amount_minor,claimed_settled_on,source_status)
      VALUES($1,$2,$3,'ota-a','RUB','booking-a','forged-clearance',
             'payout_received',10,'2026-11-16','bank_settled')`,
      [statementId,A,'11111111-1111-4111-8111-111111111111']);
    await expectFinanceRejection(`INSERT INTO ota_finance_private.statement_reviews
      (statement_import_id,account_id,property_id,provider,currency,
       actor_user_id,outcome,evidence_sha256)
      VALUES($1,$2,$3,'ota-a','RUB',$4,'accepted_for_review',$5)`,
      [statementId,A,'11111111-1111-4111-8111-111111111111',
       'dddddddd-dddd-4ddd-8ddd-dddddddddddd',digest]);
    await query('COMMIT');
    // A later non-overlapping revision is valid.
    await query(feeInsert,
      [A,'11111111-1111-4111-8111-111111111111',2,'2027-01-01',null,digest]);
    await query(`INSERT INTO ota_finance_private.statement_reviews
      (statement_import_id,account_id,property_id,provider,currency,
       actor_user_id,outcome,evidence_sha256)
      VALUES($1,$2,$3,'ota-a','RUB',$4,'accepted_for_review',$5)`,
      [statementId,A,'11111111-1111-4111-8111-111111111111',U,digest]);
    await query('BEGIN');
    await denied('service_role',"UPDATE ota_finance_private.cash_events SET amount_minor=1 WHERE external_event_id='evt-a'");
    await denied('service_role',"DELETE FROM ota_finance_private.cash_events WHERE external_event_id='evt-a'");
    await query('COMMIT');
    // An audit entry is a committed, unverified operator import, not bank proof.
    const auditIns = `INSERT INTO ota_finance_private.operation_audit
      (operation_id,account_id,property_id,actor_user_id,statement_import_id,
       provider,currency,event_count,payload_sha256)
      VALUES($1,$2,$3,$4,$5,'ota-a','RUB',1,$6) RETURNING id,outcome`;
    const operationId='f1111111-1111-4111-8111-111111111111';
    const accountProperty='11111111-1111-4111-8111-111111111111';
    const audit=(await query(auditIns,[operationId,A,accountProperty,U,statementId,digest])).rows[0];
    assert.equal(audit.outcome,'COMMITTED_UNVERIFIED');
    await query('BEGIN');
    await expectFinanceRejection(auditIns,[operationId,A,accountProperty,U,statementId,digest]);
    await expectFinanceRejection(auditIns,
      ['f2222222-2222-4222-8222-222222222222',B,accountProperty,U,statementId,digest]);
    await expectFinanceRejection(auditIns,
      ['f3333333-3333-4333-8333-333333333333',A,accountProperty,
       'dddddddd-dddd-4ddd-8ddd-dddddddddddd',statementId,digest]);
    await expectFinanceRejection(`INSERT INTO ota_finance_private.operation_audit
      (operation_id,account_id,property_id,actor_user_id,statement_import_id,
       provider,currency,event_count,payload_sha256,outcome)
      VALUES($1,$2,$3,$4,$5,'ota-a','RUB',1,$6,'BANK_VERIFIED')`,
      ['f4444444-4444-4444-8444-444444444444',A,accountProperty,U,statementId,digest]);
    await query('COMMIT');
    await query('BEGIN');
    // When audit fails, statement+cash event must disappear together.
    const provisional=(await query(`INSERT INTO ota_finance_private.statement_imports
      (account_id,property_id,provider,currency,statement_external_id,source_sha256,as_of_date)
      VALUES($1,$2,'ota-a','RUB','rollback-statement',$3,'2026-11-16')
      RETURNING id`,[A,accountProperty,digest])).rows[0].id;
    await query(`INSERT INTO ota_finance_private.cash_events
      (statement_import_id,account_id,property_id,provider,currency,booking_id,
       external_event_id,kind,amount_minor,claimed_settled_on)
      VALUES($1,$2,$3,'ota-a','RUB','booking-a','rollback-event',
             'payout_received',350,'2026-11-16')`,[provisional,A,accountProperty]);
    await expectFinanceRejection(auditIns,
      ['f5555555-5555-4555-8555-555555555555',B,accountProperty,U,provisional,digest]);
    await query('ROLLBACK');
    assert.equal((await query("SELECT count(*)::int n FROM ota_finance_private.statement_imports WHERE statement_external_id='rollback-statement'")).rows[0].n,0);
    assert.equal((await query("SELECT count(*)::int n FROM ota_finance_private.cash_events WHERE external_event_id='rollback-event'")).rows[0].n,0);
    assert.equal((await query("SELECT count(*)::int n FROM ota_finance_private.operation_audit")).rows[0].n,1);
    await query('BEGIN');
    await denied('service_role','UPDATE ota_finance_private.operation_audit SET event_count=2');
    await denied('anon','SELECT * FROM ota_finance_private.operation_audit');
    await query('COMMIT');

    const unverified=await query('SELECT source_status,amount_minor FROM ota_finance_private.cash_events');
    assert.equal(unverified.rows[0].source_status,'UNVERIFIED_OPERATOR_IMPORT');
    assert.equal(Number(unverified.rows[0].amount_minor),84800);
    t.diagnostic('OTA_PRIVATE_PG17_PROOF: real DDL, 5 RLS tables, audit FK, atomic rollback, unique operations, isolated roles, composite tenant FK, date-exclusion, fake bank status, review FK, duplicate events, no UPDATE/DELETE PASS');
  } finally {
    try { await query('ROLLBACK'); } catch {}
    if(setup){
      await query('DROP SCHEMA IF EXISTS ota_finance_private CASCADE');
      await query('DROP TABLE IF EXISTS public.booking_ops_records');
      await query('DROP TABLE IF EXISTS public.account_members');
      await query('DROP TABLE IF EXISTS public.users');
      await query('DROP TABLE IF EXISTS public.properties');
      await query('DROP TABLE IF EXISTS public.accounts');
      for(const role of ['service_role','authenticated','anon']){
        await query('DROP ROLE IF EXISTS '+role);
      }
    }
    await c.end();
  }
});
