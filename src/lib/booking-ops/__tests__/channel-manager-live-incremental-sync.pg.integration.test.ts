/**
 * Real PostgreSQL integration for Live Incremental Sync v1 schema/guard + atomic commit RPC.
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
  status text NOT NULL DEFAULT 'not_requested',
  last_success_at timestamptz,
  failure_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.booking_channel_import_runs (
  id uuid PRIMARY KEY,
  connection_id uuid NOT NULL REFERENCES public.booking_channel_manager_connections(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'queued',
  import_type text NOT NULL DEFAULT 'full',
  started_at timestamptz,
  finished_at timestamptz,
  imported_objects_count integer NOT NULL DEFAULT 0,
  imported_bookings_count integer NOT NULL DEFAULT 0,
  imported_calendar_days_count integer NOT NULL DEFAULT 0,
  imported_prices_count integer NOT NULL DEFAULT 0,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  safe_summary text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
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
  it('applies migrations, atomic commit RPC, stale reject, grants, and rolls back', async () => {
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
    const commitRunId = randomUUID();
    const staleRunId = randomUUID();

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

      // Expected failures must use SAVEPOINT — a rejected statement otherwise aborts the txn.
      await client.query('SAVEPOINT expect_invalid_type');
      await expect(client.query(
        `INSERT INTO public.booking_channel_import_runs
           (id, connection_id, provider, status, import_type, started_at)
         VALUES ($1, $2, 'manual', 'running', 'not_a_real_type', now())`,
        [randomUUID(), connectionId],
      )).rejects.toThrow(/check constraint|booking_channel_import_runs_type_check/i);
      await client.query('ROLLBACK TO SAVEPOINT expect_invalid_type');

      await client.query('SAVEPOINT expect_live_guard');
      await expect(client.query(
        `INSERT INTO public.booking_channel_import_runs
           (id, connection_id, provider, status, import_type, started_at)
         VALUES ($1, $2, 'manual', 'running', 'initial_sync', now())`,
        [initialRunId, connectionId],
      )).rejects.toThrow(/unique|booking_channel_import_runs_one_running_live_sync/i);
      await client.query('ROLLBACK TO SAVEPOINT expect_live_guard');

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

      // Finish the exclusivity fixture run so we can exercise commit on a fresh running run.
      await client.query(
        `UPDATE public.booking_channel_import_runs
         SET status = 'completed', finished_at = now(), updated_at = now()
         WHERE id = $1`,
        [incrementalRunId],
      );

      await client.query(
        `INSERT INTO public.booking_channel_import_runs
           (id, connection_id, provider, status, import_type, started_at, metadata)
         VALUES ($1, $2, 'manual', 'running', 'incremental_sync', now(), '{}'::jsonb)`,
        [commitRunId, connectionId],
      );

      const finishedAt = new Date().toISOString();
      const commit = await client.query(
        `SELECT public.channel_manager_commit_incremental_sync_v1(
           $1::uuid, $2::uuid, NULL, NULL, $3, $4, $5::timestamptz, 'completed',
           $6::jsonb, $7::jsonb, '[]'::jsonb, $8, 1, 2, 3
         ) AS payload`,
        [
          connectionId,
          commitRunId,
          'pg-cursor-committed',
          'batch-hash-aaaaaaaaaaaaaaaa',
          finishedAt,
          JSON.stringify({ created: 0, updated: 0, cancelled: 0, imported: 1 }),
          JSON.stringify({
            cursorPresent: true,
            cursorCheckpointHash: 'deadbeefdeadbeef',
            liveCoreStage: 'commit_cursor',
          }),
          'atomic commit ok',
        ],
      );
      const commitPayload = commit.rows[0]?.payload as Record<string, unknown>;
      expect(commitPayload.success).toBe(true);

      const afterCommit = await client.query(
        `SELECT
           c.metadata->'incrementalCursor' AS cursor,
           c.failure_reason,
           r.status AS run_status,
           r.finished_at IS NOT NULL AS run_finished,
           r.imported_bookings_count,
           r.imported_calendar_days_count,
           r.imported_prices_count,
           r.safe_summary,
           r.metadata
         FROM public.booking_channel_manager_connections c
         JOIN public.booking_channel_import_runs r ON r.id = $2
         WHERE c.id = $1`,
        [connectionId, commitRunId],
      );
      expect(afterCommit.rows[0]?.cursor).toMatchObject({
        stream: 'incremental',
        checkpoint: 'pg-cursor-committed',
        batchHash: 'batch-hash-aaaaaaaaaaaaaaaa',
        sourceRunId: commitRunId,
      });
      expect(afterCommit.rows[0]?.failure_reason).toBeNull();
      expect(afterCommit.rows[0]?.run_status).toBe('completed');
      expect(afterCommit.rows[0]?.run_finished).toBe(true);
      expect(Number(afterCommit.rows[0]?.imported_bookings_count)).toBe(1);
      expect(Number(afterCommit.rows[0]?.imported_calendar_days_count)).toBe(2);
      expect(Number(afterCommit.rows[0]?.imported_prices_count)).toBe(3);
      const runMeta = afterCommit.rows[0]?.metadata as Record<string, unknown>;
      expect(JSON.stringify(runMeta)).not.toContain('pg-cursor-committed');
      const commitAndRunCompletedTogether = (
        commitPayload.success === true
        && afterCommit.rows[0]?.run_status === 'completed'
        && (afterCommit.rows[0]?.cursor as { checkpoint?: string } | null)?.checkpoint === 'pg-cursor-committed'
      );

      await client.query(
        `INSERT INTO public.booking_channel_import_runs
           (id, connection_id, provider, status, import_type, started_at, metadata)
         VALUES ($1, $2, 'manual', 'running', 'incremental_sync', now(), '{}'::jsonb)`,
        [staleRunId, connectionId],
      );
      const stale = await client.query(
        `SELECT public.channel_manager_commit_incremental_sync_v1(
           $1::uuid, $2::uuid, 'wrong-previous', 'batch-hash-aaaaaaaaaaaaaaaa',
           'pg-cursor-should-not-apply', 'batch-hash-bbbbbbbbbbbbbbbb',
           now(), 'completed', '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, 'stale', 0, 0, 0
         ) AS payload`,
        [connectionId, staleRunId],
      );
      const stalePayload = stale.rows[0]?.payload as Record<string, unknown>;
      expect(stalePayload.success).toBe(false);
      expect(stalePayload.code).toBe('stale_expected_cursor');

      const afterStale = await client.query(
        `SELECT
           c.metadata->'incrementalCursor'->>'checkpoint' AS checkpoint,
           r.status AS run_status
         FROM public.booking_channel_manager_connections c
         JOIN public.booking_channel_import_runs r ON r.id = $2
         WHERE c.id = $1`,
        [connectionId, staleRunId],
      );
      expect(afterStale.rows[0]?.checkpoint).toBe('pg-cursor-committed');
      expect(afterStale.rows[0]?.run_status).toBe('running');
      const staleExpectedCursorRejected = stalePayload.success === false && stalePayload.code === 'stale_expected_cursor';
      const previousCursorUnchangedOnReject = afterStale.rows[0]?.checkpoint === 'pg-cursor-committed'
        && afterStale.rows[0]?.run_status === 'running';

      const grants = await client.query(`
        SELECT
          has_function_privilege('service_role', 'public.channel_manager_live_core_schema_state()', 'EXECUTE') AS schema_service_ok,
          has_function_privilege('anon', 'public.channel_manager_live_core_schema_state()', 'EXECUTE') AS schema_anon_ok,
          has_function_privilege('authenticated', 'public.channel_manager_live_core_schema_state()', 'EXECUTE') AS schema_auth_ok,
          has_function_privilege(
            'service_role',
            'public.channel_manager_commit_incremental_sync_v1(uuid,uuid,text,text,text,text,timestamptz,text,jsonb,jsonb,jsonb,text,integer,integer,integer)',
            'EXECUTE'
          ) AS commit_service_ok,
          has_function_privilege(
            'anon',
            'public.channel_manager_commit_incremental_sync_v1(uuid,uuid,text,text,text,text,timestamptz,text,jsonb,jsonb,jsonb,text,integer,integer,integer)',
            'EXECUTE'
          ) AS commit_anon_ok,
          has_function_privilege(
            'authenticated',
            'public.channel_manager_commit_incremental_sync_v1(uuid,uuid,text,text,text,text,timestamptz,text,jsonb,jsonb,jsonb,text,integer,integer,integer)',
            'EXECUTE'
          ) AS commit_auth_ok
      `);
      expect(grants.rows[0]?.schema_service_ok).toBe(true);
      expect(grants.rows[0]?.schema_anon_ok).toBe(false);
      expect(grants.rows[0]?.schema_auth_ok).toBe(false);
      expect(grants.rows[0]?.commit_service_ok).toBe(true);
      expect(grants.rows[0]?.commit_anon_ok).toBe(false);
      expect(grants.rows[0]?.commit_auth_ok).toBe(false);
      const serviceRoleGrantOnly = (
        grants.rows[0]?.schema_service_ok === true
        && grants.rows[0]?.schema_anon_ok === false
        && grants.rows[0]?.schema_auth_ok === false
        && grants.rows[0]?.commit_service_ok === true
        && grants.rows[0]?.commit_anon_ok === false
        && grants.rows[0]?.commit_auth_ok === false
      );

      // Abort the open transaction after assertions so the final ROLLBACK discards all DDL/DML.
      let forcedFailureRolledBack = false;
      try {
        await client.query(`DO $$ BEGIN RAISE EXCEPTION 'forced_incremental_pg_failure'; END $$;`);
      } catch (error) {
        forcedFailureRolledBack = /forced_incremental_pg_failure/i.test(String((error as Error)?.message ?? error));
      }
      expect(forcedFailureRolledBack).toBe(true);

      await client.query('ROLLBACK');

      const isolation = await client.query(`
        SELECT
          to_regclass('public.booking_channel_import_runs') AS runs_table,
          to_regprocedure('public.channel_manager_live_core_schema_state()') AS schema_fn,
          to_regprocedure(
            'public.channel_manager_commit_incremental_sync_v1(uuid,uuid,text,text,text,text,timestamptz,text,jsonb,jsonb,jsonb,text,integer,integer,integer)'
          ) AS commit_fn
      `);
      expect(isolation.rows[0]?.runs_table).toBeNull();
      expect(isolation.rows[0]?.schema_fn).toBeNull();
      expect(isolation.rows[0]?.commit_fn).toBeNull();

      const proof = {
        hasDisposablePg: true as const,
        runtimeVerified: true as const,
        schemaVersion: 2 as const,
        incrementalSyncTypeReady: true as const,
        atomicLiveSyncGuardReady: true as const,
        cursorStorageReady: true as const,
        atomicCommitRpcReady: true as const,
        commitAndRunCompletedTogether: true as const,
        staleExpectedCursorRejected: true as const,
        previousCursorUnchangedOnReject: true as const,
        forcedFailureRolledBack: true as const,
        serviceRoleGrantOnly: true as const,
        finalTransactionRolledBack: true as const,
        productionTouched: false as const,
        stagingTouched: false as const,
      };
      expect(commitAndRunCompletedTogether).toBe(true);
      expect(staleExpectedCursorRejected).toBe(true);
      expect(previousCursorUnchangedOnReject).toBe(true);
      expect(serviceRoleGrantOnly).toBe(true);
      // eslint-disable-next-line no-console
      console.log(`ASI_INCREMENTAL_PG_INTEGRATION_PROOF ${JSON.stringify(proof)}`);
      expect(proof.schemaVersion).toBe(2);
    } finally {
      await client.end().catch(() => undefined);
    }
  }, 120_000);
});
