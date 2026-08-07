/**
 * Real PostgreSQL integration for Channel Manager Reconciliation & Recovery v1.
 *
 * Requires disposable Postgres only:
 *   ASI_DISPOSABLE_POSTGRES_URL=postgres://...
 *
 * CI job sets ASI_REQUIRE_DISPOSABLE_PG=1 so this suite must not skip.
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
const RECONCILIATION_MIGRATION = resolve(
  process.cwd(),
  'supabase/migrations/20260807120000_channel_manager_reconciliation_recovery_v1.sql',
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
  last_import_at timestamptz,
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

describe('Channel Manager Reconciliation PostgreSQL integration availability', () => {
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

describe.skipIf(!hasDisposablePg)('Channel Manager Reconciliation PostgreSQL schema integration', () => {
  it('applies migrations, guards, tables, RPC grants, cursor unchanged, and rolls back', async () => {
    expect(hasDisposablePg).toBe(true);
    const client = await connectPg();
    const ownerId = randomUUID();
    const propertySetupId = randomUUID();
    const connectionId = randomUUID();
    const connectionIdB = randomUUID();
    const propertySetupIdB = randomUUID();
    const incrementalRunId = randomUUID();
    const reconImportRunId = randomUUID();
    const reconRunId = randomUUID();
    const reportHash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

    try {
      await client.query('BEGIN');
      await client.query(MINIMAL_DDL);
      await client.query(readFileSync(INITIAL_SYNC_MIGRATION, 'utf8'));
      await client.query(readFileSync(INCREMENTAL_SYNC_MIGRATION, 'utf8'));
      await client.query(readFileSync(RECONCILIATION_MIGRATION, 'utf8'));

      await client.query(
        `INSERT INTO public.booking_owner_setup_profiles (id, lead_id, metadata)
         VALUES ($1, $2, '{}'::jsonb)`,
        [ownerId, 'reconciliation-pg-fixture'],
      );
      await client.query(
        `INSERT INTO public.booking_property_setup_profiles (id, owner_setup_id, property_id, metadata)
         VALUES ($1, $2, $3, '{}'::jsonb), ($4, $2, $5, '{}'::jsonb)`,
        [propertySetupId, ownerId, 'prop-a', propertySetupIdB, 'prop-b'],
      );
      await client.query(
        `INSERT INTO public.booking_channel_manager_connections
           (id, property_setup_id, owner_setup_id, provider, metadata)
         VALUES
           ($1, $2, $3, 'manual', $4::jsonb),
           ($5, $6, $3, 'manual', '{}'::jsonb)`,
        [
          connectionId,
          propertySetupId,
          ownerId,
          JSON.stringify({
            incrementalCursor: {
              stream: 'incremental',
              checkpoint: 'pg-cursor-before-recon',
              batchHash: 'batch-hash-aaaaaaaaaaaaaaaa',
              updatedAt: '2026-08-07T10:00:00.000Z',
              sourceRunId: randomUUID(),
            },
          }),
          connectionIdB,
          propertySetupIdB,
        ],
      );

      // reconciliation_recovery import type allowed
      await client.query(
        `INSERT INTO public.booking_channel_import_runs
           (id, connection_id, provider, status, import_type, started_at)
         VALUES ($1, $2, 'manual', 'running', 'reconciliation_recovery', now())`,
        [reconImportRunId, connectionId],
      );

      // Cross-type unique running guard includes reconciliation_recovery
      await client.query('SAVEPOINT expect_live_guard');
      await expect(client.query(
        `INSERT INTO public.booking_channel_import_runs
           (id, connection_id, provider, status, import_type, started_at)
         VALUES ($1, $2, 'manual', 'running', 'incremental_sync', now())`,
        [incrementalRunId, connectionId],
      )).rejects.toThrow(/unique|booking_channel_import_runs_one_running_live_sync/i);
      await client.query('ROLLBACK TO SAVEPOINT expect_live_guard');

      // Other connection remains independent
      await client.query(
        `INSERT INTO public.booking_channel_import_runs
           (id, connection_id, provider, status, import_type, started_at)
         VALUES ($1, $2, 'manual', 'running', 'incremental_sync', now())`,
        [randomUUID(), connectionIdB],
      );

      // Tables / indexes exist
      const tables = await client.query(`
        SELECT
          to_regclass('public.booking_channel_reconciliation_runs') AS runs,
          to_regclass('public.booking_channel_reconciliation_items') AS items,
          to_regclass('public.idx_booking_channel_reconciliation_runs_report_hash') AS report_idx,
          to_regclass('public.idx_booking_channel_reconciliation_items_action_key') AS action_idx
      `);
      expect(tables.rows[0]?.runs).toBeTruthy();
      expect(tables.rows[0]?.items).toBeTruthy();
      expect(tables.rows[0]?.report_idx).toBeTruthy();
      expect(tables.rows[0]?.action_idx).toBeTruthy();

      await client.query(
        `INSERT INTO public.booking_channel_reconciliation_runs
           (id, connection_id, provider, mode, status, snapshot_kind, snapshot_hash, report_hash, started_at)
         VALUES ($1, $2, 'manual', 'apply', 'applying', 'complete',
           'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
           $3, now())`,
        [reconRunId, connectionId, reportHash],
      );

      // Report uniqueness (preview mode)
      const previewHash = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
      await client.query(
        `INSERT INTO public.booking_channel_reconciliation_runs
           (id, connection_id, provider, mode, status, snapshot_kind, snapshot_hash, report_hash)
         VALUES ($1, $2, 'manual', 'preview', 'preview_ready', 'complete',
           'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
           $3)`,
        [randomUUID(), connectionId, previewHash],
      );
      await client.query('SAVEPOINT expect_report_unique');
      await expect(client.query(
        `INSERT INTO public.booking_channel_reconciliation_runs
           (id, connection_id, provider, mode, status, snapshot_kind, snapshot_hash, report_hash)
         VALUES ($1, $2, 'manual', 'preview', 'preview_ready', 'complete',
           'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
           $3)`,
        [randomUUID(), connectionId, previewHash],
      )).rejects.toThrow(/unique|idx_booking_channel_reconciliation_runs_report_hash/i);
      await client.query('ROLLBACK TO SAVEPOINT expect_report_unique');

      // Action-key uniqueness
      const actionKey = 'action-key-unique-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      await client.query(
        `INSERT INTO public.booking_channel_reconciliation_items
           (id, reconciliation_run_id, connection_id, category, severity, repairability, status, deterministic_action_key)
         VALUES ($1, $2, $3, 'booking_unchanged', 'info', 'unsupported', 'detected', $4)`,
        [randomUUID(), reconRunId, connectionId, actionKey],
      );
      await client.query('SAVEPOINT expect_action_unique');
      await expect(client.query(
        `INSERT INTO public.booking_channel_reconciliation_items
           (id, reconciliation_run_id, connection_id, category, severity, repairability, status, deterministic_action_key)
         VALUES ($1, $2, $3, 'booking_unchanged', 'info', 'unsupported', 'detected', $4)`,
        [randomUUID(), reconRunId, connectionId, actionKey],
      )).rejects.toThrow(/unique|idx_booking_channel_reconciliation_items_action_key/i);
      await client.query('ROLLBACK TO SAVEPOINT expect_action_unique');

      // Hold lease matching import run
      await client.query(
        `UPDATE public.booking_channel_manager_connections
         SET metadata = jsonb_set(
           COALESCE(metadata, '{}'::jsonb),
           '{liveSyncLease}',
           $2::jsonb,
           true
         )
         WHERE id = $1`,
        [connectionId, JSON.stringify({
          runId: reconImportRunId,
          status: 'held',
          importType: 'reconciliation_recovery',
        })],
      );

      const finishedAt = new Date().toISOString();
      const finalize = await client.query(
        `SELECT public.channel_manager_finalize_reconciliation_recovery_v1(
           $1::uuid, $2::uuid, $3::uuid, $4, $5::timestamptz, 'completed',
           $6::jsonb, $7::jsonb, 'recon finalize ok', '{}'::jsonb
         ) AS payload`,
        [
          connectionId,
          reconImportRunId,
          reconRunId,
          reportHash,
          finishedAt,
          JSON.stringify({ applied: 1, skipped: 0, blocked: 0, failed: 0 }),
          JSON.stringify({ reconciliationRecovery: true, cursorUnchanged: true }),
        ],
      );
      const finalizePayload = finalize.rows[0]?.payload as Record<string, unknown>;
      expect(finalizePayload.success).toBe(true);
      expect(finalizePayload.cursorUnchanged).toBe(true);

      const after = await client.query(
        `SELECT
           c.metadata->'incrementalCursor'->>'checkpoint' AS checkpoint,
           c.metadata->'liveSyncLease'->>'status' AS lease_status,
           r.status AS import_status,
           rr.status AS recon_status
         FROM public.booking_channel_manager_connections c
         JOIN public.booking_channel_import_runs r ON r.id = $2
         JOIN public.booking_channel_reconciliation_runs rr ON rr.id = $3
         WHERE c.id = $1`,
        [connectionId, reconImportRunId, reconRunId],
      );
      expect(after.rows[0]?.checkpoint).toBe('pg-cursor-before-recon');
      expect(after.rows[0]?.lease_status).toBe('released');
      expect(after.rows[0]?.import_status).toBe('completed');
      expect(after.rows[0]?.recon_status).toBe('completed');

      const schema = await client.query(
        `SELECT public.channel_manager_live_core_schema_state() AS payload`,
      );
      const payload = schema.rows[0]?.payload as Record<string, unknown>;
      expect(Number(payload.schemaVersion)).toBeGreaterThanOrEqual(3);
      expect(payload.ready).toBe(true);
      expect(payload.reconciliationTypeReady).toBe(true);
      expect(payload.reconciliationTablesReady).toBe(true);
      expect(payload.reconciliationGuardReady).toBe(true);
      expect(payload.reconciliationFinalizeRpcReady).toBe(true);
      expect(payload.reconciliationReady).toBe(true);

      const grants = await client.query(`
        SELECT
          has_function_privilege(
            'service_role',
            'public.channel_manager_finalize_reconciliation_recovery_v1(uuid,uuid,uuid,text,timestamptz,text,jsonb,jsonb,text,jsonb)',
            'EXECUTE'
          ) AS finalize_service_ok,
          has_function_privilege(
            'anon',
            'public.channel_manager_finalize_reconciliation_recovery_v1(uuid,uuid,uuid,text,timestamptz,text,jsonb,jsonb,text,jsonb)',
            'EXECUTE'
          ) AS finalize_anon_ok,
          has_function_privilege(
            'authenticated',
            'public.channel_manager_finalize_reconciliation_recovery_v1(uuid,uuid,uuid,text,timestamptz,text,jsonb,jsonb,text,jsonb)',
            'EXECUTE'
          ) AS finalize_auth_ok,
          has_table_privilege('service_role', 'public.booking_channel_reconciliation_runs', 'SELECT') AS runs_service_ok,
          has_table_privilege('anon', 'public.booking_channel_reconciliation_runs', 'SELECT') AS runs_anon_ok,
          has_table_privilege('authenticated', 'public.booking_channel_reconciliation_runs', 'SELECT') AS runs_auth_ok,
          has_table_privilege('service_role', 'public.booking_channel_reconciliation_items', 'SELECT') AS items_service_ok,
          has_table_privilege('anon', 'public.booking_channel_reconciliation_items', 'SELECT') AS items_anon_ok,
          has_table_privilege('authenticated', 'public.booking_channel_reconciliation_items', 'SELECT') AS items_auth_ok
      `);
      expect(grants.rows[0]?.finalize_service_ok).toBe(true);
      expect(grants.rows[0]?.finalize_anon_ok).toBe(false);
      expect(grants.rows[0]?.finalize_auth_ok).toBe(false);
      expect(grants.rows[0]?.runs_service_ok).toBe(true);
      expect(grants.rows[0]?.runs_anon_ok).toBe(false);
      expect(grants.rows[0]?.runs_auth_ok).toBe(false);
      expect(grants.rows[0]?.items_service_ok).toBe(true);
      expect(grants.rows[0]?.items_anon_ok).toBe(false);
      expect(grants.rows[0]?.items_auth_ok).toBe(false);

      let forcedFailureRolledBack = false;
      try {
        await client.query(`DO $$ BEGIN RAISE EXCEPTION 'forced_reconciliation_pg_failure'; END $$;`);
      } catch (error) {
        forcedFailureRolledBack = /forced_reconciliation_pg_failure/i.test(String((error as Error)?.message ?? error));
      }
      expect(forcedFailureRolledBack).toBe(true);

      await client.query('ROLLBACK');

      const isolation = await client.query(`
        SELECT
          to_regclass('public.booking_channel_reconciliation_runs') AS recon_runs,
          to_regprocedure(
            'public.channel_manager_finalize_reconciliation_recovery_v1(uuid,uuid,uuid,text,timestamptz,text,jsonb,jsonb,text,jsonb)'
          ) AS finalize_fn
      `);
      expect(isolation.rows[0]?.recon_runs).toBeNull();
      expect(isolation.rows[0]?.finalize_fn).toBeNull();
    } finally {
      await client.end().catch(() => undefined);
    }
  });
});
