import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import pg from 'pg';

if (process.env.CI !== 'true' || process.env.STRIGUNOV_SYNTHETIC_ONLY !== 'YES') {
  throw new Error('Only explicit synthetic CI execution is allowed');
}
const url = new URL(process.env.TASK29B_DATABASE_URL || '');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/task29b') {
  throw new Error('Refusing a nonlocal or unexpected PostgreSQL target');
}
const options = { connectionString: url.toString(), connectionTimeoutMillis: 5000 };
const a = new pg.Client(options);
const b = new pg.Client(options);
let created = false;
try {
  await a.connect();
  await b.connect();
  await a.query("CREATE SCHEMA IF NOT EXISTS auth");
  await a.query("CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS 'SELECT current_user::text'");
  const migration = readFileSync('supabase/migrations/20260619000001_crm_early_access_v1.sql', 'utf8');
  await a.query(migration);
  const name = 'Task29B synthetic only';
  const inserted = await a.query(
    "INSERT INTO public.crm_contacts (name, source, role, status, communication_status, telegram_username) VALUES ($1, 'test', 'owner', 'new_lead', 'no_contact', $2) RETURNING id",
    [name, 'task29b_test_only']
  );
  created = true;
  const id = inserted.rows[0].id;
  assert.match(id, /^[a-f0-9-]{36}$/i);
  const readback = await b.query('SELECT id, name, source, telegram_username FROM public.crm_contacts WHERE id=$1', [id]);
  assert.equal(readback.rowCount, 1);
  assert.deepEqual(readback.rows[0], { id, name, source: 'test', telegram_username: 'task29b_test_only' });
  await a.query('DELETE FROM public.crm_contacts WHERE id=$1', [id]);
  created = false;
  const after = await b.query('SELECT id FROM public.crm_contacts WHERE id=$1', [id]);
  assert.equal(after.rowCount, 0);
  process.stdout.write('NATIVE_POSTGRES_SCHEMA_INSERT_SEPARATE_CONNECTION_READBACK_CLEANUP=PASS\n');
  process.stdout.write('API_TO_POSTGREST_OPERATOR_QUEUE=NOT_RUN\nFULL_BOOKING_OPS_E2E=NOT_RUN\n');
} finally {
  if (created) await a.query("DELETE FROM public.crm_contacts WHERE telegram_username='task29b_test_only'").catch(() => {});
  await Promise.allSettled([a.end(), b.end()]);
}
