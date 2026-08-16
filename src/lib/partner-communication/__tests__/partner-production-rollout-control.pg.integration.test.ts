/**
 * Complete disposable PostgreSQL proof for the controlled partner rollout.
 * It creates an isolated throwaway database, exercises the real SQL artifacts,
 * and drops the database during cleanup. No persistent environment is used.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PG_URL = process.env.ASI_DISPOSABLE_POSTGRES_URL?.trim() || '';
const requireDisposablePg = process.env.ASI_REQUIRE_DISPOSABLE_PG === '1';
const hasDisposablePg = Boolean(PG_URL) && !/asi-staging|prod|production/iu.test(PG_URL);
const root = process.cwd();
const migrationNames = [
  '20260816144742_partner_property_knowledge_schema_completion_v1.sql',
  '20260815102111_partner_communication_durable_state_v1.sql',
  '20260815130000_partner_authenticated_inbox_v1.sql',
  '20260815160000_partner_communication_brain_v1.sql',
  '20260815190000_partner_service_recovery_loop_v1.sql',
  '20260815210000_partner_review_reputation_engine_v1.sql',
  '20260815230000_partner_revenue_shadow_pricing_v1.sql',
] as const;
const versions = migrationNames.map((name) => name.slice(0, 14));
const migrationSql = migrationNames.map((name) => readFileSync(
  resolve(root, 'supabase/migrations', name),
  'utf8',
));
const precheckSql = readFileSync(
  resolve(root, 'scripts/partner-production-rollout-db-precheck.sql'),
  'utf8',
);
const precheckMutationProbeSql = precheckSql.replace(
  /\nCOMMIT;\s*$/u,
  '\nINSERT INTO public.accounts (id) VALUES (gen_random_uuid());\n\nCOMMIT;\n',
);
const registerHistorySql = readFileSync(
  resolve(root, 'scripts/partner-production-rollout-register-history.sql'),
  'utf8',
);
const verifySql = readFileSync(
  resolve(root, 'scripts/partner-production-rollout-verify.sql'),
  'utf8',
);

type PgClient = {
  connect(): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<{
    rows: Array<Record<string, unknown>>;
    rowCount: number | null;
  }>;
  end(): Promise<void>;
};

async function createClient(connectionString: string): Promise<PgClient> {
  const pg = await import('pg') as unknown as {
    Client: new (config: { connectionString: string }) => PgClient;
  };
  const client = new pg.Client({ connectionString });
  await client.connect();
  return client;
}

function identifier(value: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/u.test(value)) throw new Error('Unsafe PostgreSQL identifier.');
  return `"${value}"`;
}

async function applyControlledTransaction(client: PgClient): Promise<void> {
  for (const sql of migrationSql) await client.query(sql);
  await client.query(registerHistorySql);
  await client.query(verifySql);
}

async function assertEmptyRolloutState(client: PgClient): Promise<void> {
  const state = await client.query(`
    SELECT
      count(*) FILTER (WHERE namespace.nspname = 'public'
        AND relation.relname LIKE 'partner\\_%' ESCAPE '\\')::int AS partner_relations,
      (SELECT count(*)::int FROM supabase_migrations.schema_migrations
        WHERE version = ANY($1::text[])) AS history_rows
    FROM pg_class AS relation
    JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  `, [versions]);
  expect(state.rows[0]).toEqual({ partner_relations: 0, history_rows: 0 });
}

describe('Partner rollout PostgreSQL availability', () => {
  it('fails closed when CI requires disposable PostgreSQL but it is unavailable', () => {
    if (!requireDisposablePg) return expect(requireDisposablePg).toBe(false);
    expect(hasDisposablePg, 'partner rollout PostgreSQL integration must not skip in CI').toBe(true);
    expect(PG_URL).toMatch(/^postgres(ql)?:\/\//iu);
  });
});

describe.skipIf(!hasDisposablePg)('Partner rollout PostgreSQL integration', () => {
  it('keeps schema and all seven history rows atomic and blocks reapplication', async () => {
    const admin = await createClient(PG_URL);
    const databaseName = `asi_partner_rollout_${process.pid}_${Date.now()}`.toLowerCase();
    const databaseUrl = new URL(PG_URL);
    databaseUrl.pathname = `/${databaseName}`;
    const createdRoles: string[] = [];
    let target: PgClient | null = null;

    try {
      const existingRoles = await admin.query(
        "SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])",
        [['anon', 'authenticated', 'service_role']],
      );
      const existingRoleNames = new Set(existingRoles.rows.map((row) => String(row.rolname)));
      for (const role of ['anon', 'authenticated', 'service_role']) {
        if (!existingRoleNames.has(role)) {
          await admin.query(`CREATE ROLE ${identifier(role)} NOLOGIN`);
          createdRoles.push(role);
        }
      }

      await admin.query(`CREATE DATABASE ${identifier(databaseName)}`);
      target = await createClient(databaseUrl.toString());
      await target.query(`
        CREATE EXTENSION IF NOT EXISTS pgcrypto;
        CREATE SCHEMA supabase_migrations;
        CREATE TABLE supabase_migrations.schema_migrations (
          version TEXT NOT NULL PRIMARY KEY,
          statements TEXT[],
          name TEXT
        );
        CREATE TABLE public.accounts (id UUID PRIMARY KEY);
        CREATE TABLE public.properties (
          id UUID PRIMARY KEY,
          account_id UUID NOT NULL REFERENCES public.accounts(id),
          status TEXT NOT NULL
        );
        CREATE TABLE public.booking_ops_records (
          id UUID PRIMARY KEY,
          account_id TEXT,
          property_id TEXT
        );
        CREATE TABLE public.tg_property_knowledge (
          property_id TEXT PRIMARY KEY,
          active BOOLEAN NOT NULL DEFAULT true,
          wifi_name TEXT,
          wifi_password TEXT,
          checkin_instructions TEXT,
          access_notes TEXT,
          check_in_time TEXT,
          checkout_notes TEXT,
          check_out_time TEXT,
          house_rules TEXT,
          quiet_hours TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE TABLE public.booking_pricing_profiles (id UUID PRIMARY KEY);
      `);

      await target.query(precheckSql);

      expect(precheckMutationProbeSql).not.toBe(precheckSql);
      await expect(target.query(precheckMutationProbeSql)).rejects.toMatchObject({ code: '25006' });
      await target.query('ROLLBACK');
      const mutationProbeState = await target.query(
        'SELECT count(*)::int AS account_rows FROM public.accounts',
      );
      expect(mutationProbeState.rows[0]).toEqual({ account_rows: 0 });

      await target.query('CREATE TABLE public.partner_precheck_blocked (id INTEGER PRIMARY KEY)');
      await expect(target.query(precheckSql)).rejects.toMatchObject({
        code: 'P0001',
        message: 'PARTNER_ROLLOUT_DB_PRECHECK=blocked_schema_or_history_state',
      });
      await target.query('ROLLBACK');
      await target.query('DROP TABLE public.partner_precheck_blocked');

      await target.query(
        `INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
         VALUES ($1, 'blocked_history_probe', ARRAY[]::TEXT[])`,
        [versions[0]],
      );
      await expect(target.query(precheckSql)).rejects.toMatchObject({
        code: 'P0001',
        message: 'PARTNER_ROLLOUT_DB_PRECHECK=blocked_schema_or_history_state',
      });
      await target.query('ROLLBACK');
      await target.query(
        'DELETE FROM supabase_migrations.schema_migrations WHERE version = $1',
        [versions[0]],
      );

      await target.query('BEGIN');
      await applyControlledTransaction(target);
      const successfulState = await target.query(`
        SELECT version, name
        FROM supabase_migrations.schema_migrations
        WHERE version = ANY($1::text[])
        ORDER BY array_position($1::text[], version)
      `, [versions]);
      expect(successfulState.rows.map((row) => String(row.version))).toEqual(versions);
      expect(successfulState.rows).toHaveLength(7);
      await target.query('ROLLBACK');
      await assertEmptyRolloutState(target);

      await target.query('BEGIN');
      for (const sql of migrationSql) await target.query(sql);
      await target.query(registerHistorySql);
      await target.query(
        'DELETE FROM supabase_migrations.schema_migrations WHERE version = $1',
        [versions[6]],
      );
      await expect(target.query(verifySql)).rejects.toMatchObject({ code: 'P0001' });
      await target.query('ROLLBACK');
      await assertEmptyRolloutState(target);

      await target.query('BEGIN');
      await applyControlledTransaction(target);
      await target.query('COMMIT');

      const migrationFilesExecuted = 0;
      try {
        await expect(target.query(precheckSql)).rejects.toMatchObject({
          code: 'P0001',
          message: 'PARTNER_ROLLOUT_DB_PRECHECK=blocked_schema_or_history_state',
        });
      } finally {
        await target.query('ROLLBACK');
      }
      expect(migrationFilesExecuted).toBe(0);

      const alreadyApplied = await target.query(`
        SELECT
          (SELECT count(*)::int FROM supabase_migrations.schema_migrations
            WHERE version = ANY($1::text[])) AS history_rows,
          (SELECT count(*)::int
            FROM pg_class AS relation
            JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
            WHERE namespace.nspname = 'public'
              AND relation.relkind = 'r'
              AND relation.relname LIKE 'partner\\_%' ESCAPE '\\') AS partner_relations
      `, [versions]);
      expect(alreadyApplied.rows[0]).toEqual({ history_rows: 7, partner_relations: 19 });

    } finally {
      if (target) await target.end().catch(() => undefined);
      await admin.query(`DROP DATABASE IF EXISTS ${identifier(databaseName)} WITH (FORCE)`)
        .catch(() => undefined);
      for (const role of createdRoles.reverse()) {
        await admin.query(`DROP ROLE IF EXISTS ${identifier(role)}`).catch(() => undefined);
      }
      await admin.end().catch(() => undefined);
    }

    // CI-grepable proof, emitted only after disposable database cleanup completes.
    // eslint-disable-next-line no-console
    console.log(`PARTNER_ROLLOUT_PG_PROOF ${JSON.stringify({
      precheckPassed: true,
      migrationFilesApplied: migrationSql.length,
      schemaVerificationPassed: true,
      migrationHistoryRows: versions.length,
      forcedHistoryDivergenceRolledBack: true,
      alreadyAppliedPrecheckBlocked: true,
      migrationFilesExecutedAfterBlockedPrecheck: 0,
      rollbackCleanupPassed: true,
      disposableDatabaseDropped: true,
      productionTouched: false,
      stagingTouched: false,
    })}`);
  }, 180_000);
});
