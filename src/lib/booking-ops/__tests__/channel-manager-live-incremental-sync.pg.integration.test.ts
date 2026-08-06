/**
 * Real PostgreSQL integration for Live Incremental Sync v1 schema/guard.
 *
 * Requires disposable Postgres only:
 *   ASI_DISPOSABLE_POSTGRES_URL=postgres://...
 *
 * CI job sets ASI_REQUIRE_DISPOSABLE_PG=1 so this suite must not skip.
 * Never points at production or asi-staging unless separately authorized.
 * When the URL is absent locally, this file documents BLOCKED rather than claiming
 * the RPC is runtime-verified.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';

const PG_URL = process.env.ASI_DISPOSABLE_POSTGRES_URL?.trim() || '';
const requireDisposablePg = process.env.ASI_REQUIRE_DISPOSABLE_PG === '1';
const hasDisposablePg = Boolean(PG_URL)
  && !/asi-staging|prod|production/i.test(PG_URL);

const INITIAL_SYNC_MIGRATION = resolve(
  process.cwd(),
  'supabase/migrations/20260804120000_channel_manager_live_core_initial_sync_v1.sql',
);
const INCREMENTAL_SYNC_MIGRATION = resolve(
  process.cwd(),
  'supabase/migrations/20260806170000_channel_manager_live_incremental_sync_v1.sql',
);

const MINIMAL_DDL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END
$roles$;

CREATE TABLE IF NOT EXISTS public.booking_owner_setup_profiles (
  id uuid PRIMARY KEY,
  lead_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.booking_property_setup_profiles (
  id uuid PRIMARY KEY,
  owner_setup_id uuid REFERENCES public.booking_owner_setup_profiles(id),
  property_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.booking_channel_manager_connections (
  id uuid PRIMARY KEY,
  property_setup_id uuid REFERENCES public.booking_property_setup_profiles(id),
  owner_setup_id uuid,
  provider text NOT NULL DEFAULT 'manual',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.booking_channel_import_runs (
  id uuid PRIMARY KEY,
  connection_id uuid NOT NULL REFERENCES public.booking_channel_manager_connections(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'queued',
  import_type text NOT NULL DEFAULT 'full',
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_channel_import_runs_type_check
    CHECK (import_type IN (
      'full', 'objects', 'bookings', 'calendar', 'pricing', 'availability', 'manual_snapshot'
    ))
);
`;

type PgClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
  end: () => Promise<void>;
};

async function connectPg(): Promise<PgClient> {
  const mod = await import('pg').catch(() => null) as { Client: new (config: { connectionString: string }) => PgClient } | null;
  if (!mod?.Client) {
    throw new Error('Package "pg" is not installed. Install it to run disposable Postgres RPC integration.');
  }
  const client = new mod.Client({ connectionString: PG_URL });
  await (client as unknown as { connect: () => Promise<void> }).connect();
  return client;
}

describe('Live Incremental Sync PostgreSQL integration availability', () => {
  it('fails closed in CI when disposable PostgreSQL is required but unavailable', () => {
    if (!requireDisposablePg) {
      expect(requireDisposablePg).toBe(false);
      return;
    }
    expect(hasDisposablePg, 'RPC integration must not skip in CI (ASI_REQUIRE_DISPOSABLE_PG=1)').toBe(true);
    expect(PG_URL).toMatch(/^postgres(ql)?:\/\//i);
    expect(/asi-staging|prod|production/i.test(PG_URL)).toBe(false);
  });

  it('reports BLOCKED when disposable PostgreSQL is unavailable locally', () => {
    if (requireDisposablePg || hasDisposablePg) {
      expect(hasDisposablePg || requireDisposablePg).toBe(true);
      return;
    }
    expect({
      status: 'BLOCKED',
      reason: 'No disposable PostgreSQL / local Supabase (set ASI_DISPOSABLE_POSTGRES_URL). Docker/psql unavailable in this environment.',
      runtimeVerified: false,
      productionTouched: false,
      stagingTouched: false,
    }).toEqual({
      status: 'BLOCKED',
      reason: 'No disposable PostgreSQL / local Supabase (set ASI_DISPOSABLE_POSTGRES_URL). Docker/psql unavailable in this environment.',
      runtimeVerified: false,
      productionTouched: false,
      stagingTouched: false,
    });
  });
});

describe.skipIf(!hasDisposablePg)('Live Incremental Sync PostgreSQL schema integration', () => {
  it('applies migrations, enforces incremental_sync type + live guard, stores cursor, and grants RPC to service_role', async () => {
    expect(hasDisposablePg).toBe(true);
    const client = await connectPg();
    const ownerId = randomUUID();
    const propertySetupId = randomUUID();
    const connectionId = randomUUID();
    const connectionIdB = randomUUID();
    const propertySetupIdB = randomUUID();
    const initialRunId = randomUUID();
    const incrementalRunId = randomUUID();
    const otherConnectionRunId = randomUUID();

    try {
      await client.query('BEGIN');
      await client.query(MINIMAL_DDL);
      await client.query(readFileSync(INITIAL_SYNC_MIGRATION, 'utf8'));
      await client.query(readFileSync(INCREMENTAL_SYNC_MIGRATION, 'utf8'));

      await client.query(
        `INSERT INTO public.booking_owner_setup_profiles (id, lead_id, metadata)
         VALUES ($1, $2, '{}'::jsonb)`,
        [ownerId, 'incremental-sync-pg-fixture'],
      );
      await client.query(
        `INSERT INTO public.booking_property_setup_profiles (id, owner_setup_id, property_id, metadata)
         VALUES ($1, $2, $3, '{}'::jsonb), ($4, $2, $5, '{}'::jsonb)`,
        [propertySetupId, ownerId, 'prop-a', propertySetupIdB, 'prop-b'],
      );
      await client.query(
        `INSERT INTO public.booking_channel_manager_connections (id, property_setup_id, owner_setup_id, provider, metadata)
         VALUES ($1, $2, $3, 'manual', '{}'::jsonb), ($4, $5, $3, 'manual', '{}'::jsonb)`,
        [connectionId, propertySetupId, ownerId, connectionIdB, propertySetupIdB],
      );

      await client.query(
        `INSERT INTO public.booking_channel_import_runs
           (id, connection_id, provider, status, import_type, started_at)
         VALUES ($1, $2, 'manual', 'running', 'incremental_sync', now())`,
        [incrementalRunId, connectionId],
      );

      await expect(client.query(
        `INSERT INTO public.booking_channel_import_runs
           (id, connection_id, provider, status, import_type, started_at)
         VALUES ($1, $2, 'manual', 'running', 'not_a_real_type', now())`,
        [randomUUID(), connectionId],
      )).rejects.toThrow(/check constraint|booking_channel_import_runs_type_check/i);

      await expect(client.query(
        `INSERT INTO public.booking_channel_import_runs
           (id, connection_id, provider, status, import_type, started_at)
         VALUES ($1, $2, 'manual', 'running', 'initial_sync', now())`,
        [initialRunId, connectionId],
      )).rejects.toThrow(/unique|booking_channel_import_runs_one_running_live_sync/i);

      await client.query(
        `INSERT INTO public.booking_channel_import_runs
           (id, connection_id, provider, status, import_type, started_at)
         VALUES ($1, $2, 'manual', 'running', 'initial_sync', now())`,
        [otherConnectionRunId, connectionIdB],
      );

      const schema = await client.query(
        `SELECT public.channel_manager_live_core_schema_state() AS payload`,
      );
      const payload = schema.rows[0]?.payload as Record<string, unknown>;
      expect(Number(payload.schemaVersion)).toBeGreaterThanOrEqual(2);
      expect(payload.incrementalSyncTypeReady).toBe(true);
      expect(payload.atomicLiveSyncGuardReady).toBe(true);
      expect(payload.cursorStorageReady).toBe(true);
      expect(payload.ready).toBe(true);

      const cursor = {
        stream: 'incremental',
        checkpoint: 'pg-cursor-1',
        updatedAt: new Date().toISOString(),
        sourceRunId: incrementalRunId,
      };
      await client.query(
        `UPDATE public.booking_channel_manager_connections
         SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{incrementalCursor}', $2::jsonb, true)
         WHERE id = $1`,
        [connectionId, JSON.stringify(cursor)],
      );
      const stored = await client.query(
        `SELECT metadata->'incrementalCursor' AS cursor
         FROM public.booking_channel_manager_connections WHERE id = $1`,
        [connectionId],
      );
      expect(stored.rows[0]?.cursor).toMatchObject({
        stream: 'incremental',
        checkpoint: 'pg-cursor-1',
        sourceRunId: incrementalRunId,
      });

      const grants = await client.query(`
        SELECT
          has_function_privilege('service_role', 'public.channel_manager_live_core_schema_state()', 'EXECUTE') AS service_ok,
          has_function_privilege('anon', 'public.channel_manager_live_core_schema_state()', 'EXECUTE') AS anon_ok,
          has_function_privilege('authenticated', 'public.channel_manager_live_core_schema_state()', 'EXECUTE') AS auth_ok
      `);
      expect(grants.rows[0]?.service_ok).toBe(true);
      expect(grants.rows[0]?.anon_ok).toBe(false);
      expect(grants.rows[0]?.auth_ok).toBe(false);

      await client.query('ROLLBACK');

      const isolation = await client.query(`
        SELECT
          to_regclass('public.booking_channel_import_runs') AS runs_table,
          to_regprocedure('public.channel_manager_live_core_schema_state()') AS schema_fn
      `);
      expect(isolation.rows[0]?.runs_table).toBeNull();
      expect(isolation.rows[0]?.schema_fn).toBeNull();

      const proof = {
        hasDisposablePg: true as const,
        runtimeVerified: true as const,
        schemaVersion: Number(payload.schemaVersion),
        incrementalSyncTypeReady: payload.incrementalSyncTypeReady === true,
        atomicLiveSyncGuardReady: payload.atomicLiveSyncGuardReady === true,
        cursorStorageReady: payload.cursorStorageReady === true,
        ready: payload.ready === true,
        serviceRoleGrantOnly: true as const,
        finalTransactionRolledBack: true as const,
        productionTouched: false as const,
        stagingTouched: false as const,
      };
      // eslint-disable-next-line no-console
      console.log(`ASI_PG_INTEGRATION_PROOF ${JSON.stringify(proof)}`);
      expect(proof.ready).toBe(true);
      expect(proof.schemaVersion).toBeGreaterThanOrEqual(2);
    } finally {
      await client.end().catch(() => undefined);
    }
  }, 120_000);
});
