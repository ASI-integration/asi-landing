// Isolated, ephemeral SQL smoke test. Requires PGLite installed explicitly in
// the test environment; never points at live Supabase or one.com databases.
// PGLITE_MODULE=/path/to/node_modules/@electric-sql/pglite node scripts/acceptance/ops-v17-owner-change-pglite.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
const migration = 'supabase/migrations/20261115073117_owner_change_receipts_atomic_v1.sql';

try {
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE public.ops_v17_onboardings (
      id uuid PRIMARY KEY, account_id text NOT NULL UNIQUE,
      current_step text NOT NULL DEFAULT 'business',
      data jsonb NOT NULL DEFAULT '{}'::jsonb,
      progress integer NOT NULL DEFAULT 0,
      updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.ops_v17_audit_log (
      id uuid PRIMARY KEY, onboarding_id uuid NOT NULL REFERENCES public.ops_v17_onboardings(id),
      action text NOT NULL, actor_id text NOT NULL, detail jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    GRANT SELECT,INSERT,UPDATE ON public.ops_v17_onboardings TO service_role;
    GRANT SELECT,INSERT ON public.ops_v17_audit_log TO service_role;
  `);
  await db.exec(readFileSync(migration, 'utf8'));
  await db.exec('SET ROLE service_role');

  const apply = async (requestId, section, values, expected) => {
    const response = await db.query(
      'SELECT public.apply_ops_v17_owner_change($1::text,$2::text,$3::uuid,$4::text,$5::jsonb,$6::jsonb) AS outcome',
      ['account-A', 'user-A', requestId, section, JSON.stringify(values), JSON.stringify(expected)],
    );
    return response.rows[0].outcome;
  };
  const firstId = '123e4567-e89b-42d3-a456-426614174000';
  const secondId = '123e4567-e89b-42d3-a456-426614174001';
  const first = await apply(firstId, 'business', { name: 'ASI Owner' }, {});
  assert.equal(first.status, 'applied_internal');
  assert.equal(first.externalStatus, 'not_required');

  const duplicate = await apply(firstId, 'business', { name: 'ASI Owner' }, {});
  assert.equal(duplicate.status, 'applied_internal');
  assert.equal(duplicate.replayed, true);

  const conflict = await apply(secondId, 'business', { name: 'Stale Update' }, {});
  assert.equal(conflict.status, 'conflict');

  const stored = await db.query("SELECT data FROM public.ops_v17_onboardings WHERE account_id='account-A'");
  assert.equal(stored.rows[0].data.business.name, 'ASI Owner');
  const receipts = await db.query("SELECT id,status FROM public.ops_v17_owner_change_receipts ORDER BY id");
  assert.equal(receipts.rows.length, 2);
  assert.deepEqual(receipts.rows.map((row) => row.status).sort(), ['applied_internal', 'conflict']);
  const audit = await db.query("SELECT action FROM public.ops_v17_audit_log");
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0].action, 'owner_change_verified_applied');

  const opsId = '123e4567-e89b-42d3-a456-426614174002';
  const rules = { cleaningRule: 'У'.repeat(1900), checkInTime: '14:00' };
  const ops = await apply(opsId, 'operations', rules, {});
  assert.equal(ops.status, 'applied_internal');
  assert.equal(ops.externalStatus, 'awaiting_verified_adapter');
  const after = await db.query("SELECT data FROM public.ops_v17_onboardings WHERE account_id='account-A'");
  assert.equal(after.rows[0].data.operations.cleaningRule, rules.cleaningRule);

  await db.exec('SET ROLE anon');
  await assert.rejects(
    db.query("SELECT public.apply_ops_v17_owner_change('account-A','user-A','123e4567-e89b-42d3-a456-426614174003'::uuid,'business','{}'::jsonb,'{}'::jsonb)"),
    /permission denied|not allowed/i,
  );

  console.log('PGLITE_SQL_SMOKE_PASS: atomic apply, readback, replay, conflict, audit, Cyrillic, external gate, privilege boundary');
} catch (error) {
  console.error('PGLITE_SQL_SMOKE_FAILED:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await db.close();
}
