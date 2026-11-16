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
    await query('INSERT INTO public.accounts(id) VALUES ($1),($2)',[A,B]);
    await query('INSERT INTO public.users(id) VALUES ($1)',[U]);
    await query('INSERT INTO public.properties(id,account_id) VALUES ($1,$2),($3,$4)',
      ['11111111-1111-4111-8111-111111111111',A,'22222222-2222-4222-8222-222222222222',B]);
    await query('COMMIT');
    setup=true;
    await query(sql);
    const schema=await query(
      "SELECT tablename,rowsecurity FROM pg_tables WHERE schemaname='ota_finance_private' ORDER BY tablename");
    assert.deepEqual(schema.rows.map(x=>x.tablename),
      ['cash_events','fee_rule_versions','statement_imports','statement_reviews']);
    assert.ok(schema.rows.every(x=>x.rowsecurity===true));
    assert.equal((await query("SELECT has_schema_privilege('anon','ota_finance_private','USAGE') allowed")).rows[0].allowed,false);
    assert.equal((await query("SELECT has_schema_privilege('authenticated','ota_finance_private','USAGE') allowed")).rows[0].allowed,false);
    assert.equal((await query("SELECT has_table_privilege('service_role','ota_finance_private.cash_events','UPDATE') allowed")).rows[0].allowed,false);
    assert.equal((await query("SELECT has_table_privilege('service_role','ota_finance_private.cash_events','INSERT') allowed")).rows[0].allowed,true);
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
    await query('BEGIN');
    await denied('service_role',"UPDATE ota_finance_private.cash_events SET amount_minor=1 WHERE external_event_id='evt-a'");
    await denied('service_role',"DELETE FROM ota_finance_private.cash_events WHERE external_event_id='evt-a'");
    await query('COMMIT');
    const unverified=await query('SELECT source_status,amount_minor FROM ota_finance_private.cash_events');
    assert.equal(unverified.rows[0].source_status,'UNVERIFIED_OPERATOR_IMPORT');
    assert.equal(Number(unverified.rows[0].amount_minor),84800);
    t.diagnostic('OTA_PRIVATE_PG17_PROOF: real DDL, 4 RLS tables, isolated roles, composite tenant FK, duplicate events, no UPDATE/DELETE PASS');
  } finally {
    try { await query('ROLLBACK'); } catch {}
    if(setup){
      await query('DROP SCHEMA IF EXISTS ota_finance_private CASCADE');
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
