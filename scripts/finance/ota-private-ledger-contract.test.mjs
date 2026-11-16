import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const path = new URL('../../docs/finance/sql/ota-finance-private-ledger-candidate.sql', import.meta.url);
const sql = readFileSync(path, 'utf8');
const tables = ['fee_rule_versions','statement_imports','cash_events','statement_reviews'];

test('candidate is explicitly NOT an applied migration', () => {
  assert.match(sql, /CANDIDATE ONLY, NOT AN APPLIED SUPABASE MIGRATION/i);
  assert.match(sql, /begin;[\s\S]+commit;/i);
});

test('schema does not grant direct client access', () => {
  assert.match(sql, /create schema if not exists ota_finance_private;/i);
  assert.match(sql, /revoke all on schema ota_finance_private from public, anon, authenticated;/i);
  assert.doesNotMatch(sql, /grant\s+(?:select|insert|update|delete|all)\b[^;]*\bto\s+(?:anon|authenticated)\b/i);
  assert.doesNotMatch(sql, /\bsecurity\s+definer\b/i);
});

test('all proposed finance tables enable RLS', () => {
  for (const table of tables) {
    assert.match(sql,new RegExp('create table ota_finance_private\\.'+table+' \\(', 'i'));
    assert.match(sql,new RegExp('alter table ota_finance_private\\.'+table+' enable row level security;', 'i'));
  }
});

test('only SELECT and INSERT are granted to the server role',()=>{
  const grants=[...sql.matchAll(/grant\s+([^;]+);/gi)].map(x=>x[1]);
  assert(grants.some(g=>/^usage on schema ota_finance_private to service_role$/i.test(g.trim())));
  assert(grants.some(g=>/select, insert on table[\s\S]*to service_role$/i.test(g.trim())));
  assert(!grants.some(g=>/\b(update|delete|truncate|all)\b/i.test(g)));
  assert.match(sql,/revoke all on table[\s\S]*from public, anon, authenticated, service_role;/i);
});

test('all family records have tenant account UUID and a property boundary',()=>{
  for (const table of tables){
    const start=sql.indexOf('create table ota_finance_private.'+table+' (');
    const end=sql.indexOf('\n);',start);
    assert(start>=0 && end>start);
    const block=sql.slice(start,end);
    assert.match(block,/account_id uuid not null/);
    assert.match(block,/property_id text not null/);
  }
});

test('source statements remain explicitly unverified',()=>{
  assert.match(sql,/source_status text not null default 'UNVERIFIED_OPERATOR_IMPORT'/);
  assert.match(sql,/provenance text not null default 'OPERATOR_SUPPLIED_NORMALIZED_CSV'/);
  assert.doesNotMatch(sql,/default 'bank_settled'/);
});

test('cash events require a composite tenant/provider/currency parent key',()=>{
  assert.match(sql,/foreign key \(statement_import_id, account_id, property_id, provider, currency\)/);
  assert.match(sql,/unique\(id, account_id, property_id, provider, currency\)/);
  assert.match(sql,/unique\(account_id, property_id, provider, currency, external_event_id\)/);
});

test('cash amounts have bounded integer minor units and currency check',()=>{
  assert.match(sql,/amount_minor bigint not null check \(amount_minor between 0 and 1000000000000\)/);
  assert.match(sql,/currency ~ '\^\[A-Z\]\{3\}\$'/);
});

test('rules cannot silently treat missing fees as zero',()=>{
  assert.match(sql,/commission_bps integer not null/);
  assert.match(sql,/fixed_minor bigint not null/);
  assert.match(sql,/source_digest_sha256 text not null/);
  assert.match(sql,/effective_from date not null/);
  assert.match(sql,/effective_through date/);
});

test('schema stores a review as a separate immutable event, not as bank proof',()=>{
  assert.match(sql,/create table ota_finance_private.statement_reviews/);
  assert.match(sql,/outcome text not null check \(outcome in \('accepted_for_review','rejected'\)\)/);
  assert.doesNotMatch(sql,/\bgrant update\b/i);
});
