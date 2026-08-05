/**
 * Real PostgreSQL RPC integration for Live Core synthetic recovery.
 *
 * Requires disposable Postgres only:
 *   ASI_DISPOSABLE_POSTGRES_URL=postgres://...
 *
 * Never points at production or asi-staging unless separately authorized.
 * When the URL is absent, this file documents BLOCKED rather than claiming
 * the RPC is runtime-verified.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  LEGACY_ORPHAN_67_ROW_SHAPE,
  LEGACY_ORPHAN_67_ROW_TOTAL,
} from '../channel-manager-live-core-recovery';
import {
  LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID,
  LIVE_CORE_ACCEPTANCE_GUEST_NAME,
  LIVE_CORE_ACCEPTANCE_HARNESS,
  LIVE_CORE_ACCEPTANCE_PROPERTY_ID,
  LIVE_CORE_RECOVERY_CONFIRM_PHRASE,
} from '../channel-manager-live-core-acceptance-constants';

const PG_URL = process.env.ASI_DISPOSABLE_POSTGRES_URL?.trim() || '';
const hasDisposablePg = Boolean(PG_URL)
  && !/asi-staging|prod|production/i.test(PG_URL);

const MIGRATION_PATH = resolve(
  process.cwd(),
  'supabase/migrations/20260805120000_channel_manager_live_core_synthetic_recovery_v1.sql',
);
const FIXTURE_DDL_PATH = resolve(
  process.cwd(),
  'scripts/fixtures/channel-manager-live-core-recovery-pg-fixture.sql',
);

type PgClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
  end: () => Promise<void>;
};

async function connectPg(): Promise<PgClient> {
  // Optional dependency — only required when a disposable URL is provided.
  const mod = await import('pg').catch(() => null) as { Client: new (config: { connectionString: string }) => PgClient } | null;
  if (!mod?.Client) {
    throw new Error('Package "pg" is not installed. Install it to run disposable Postgres RPC integration.');
  }
  const client = new mod.Client({ connectionString: PG_URL });
  await (client as unknown as { connect: () => Promise<void> }).connect();
  return client;
}

describe('Live Core recovery PostgreSQL integration availability', () => {
  it('reports BLOCKED when disposable PostgreSQL is unavailable', () => {
    if (hasDisposablePg) {
      expect(PG_URL).toMatch(/^postgres(ql)?:\/\//i);
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

describe.skipIf(!hasDisposablePg)('Live Core recovery PostgreSQL RPC integration', () => {
  it('applies migration, seeds 67-row fixture, dry-runs, commits cleanup, and rolls back mid-delete failure', async () => {
    expect(LEGACY_ORPHAN_67_ROW_TOTAL).toBe(67);
    const client = await connectPg();
    const ownerId = randomUUID();
    const propertySetupId = randomUUID();
    const connectionId = randomUUID();
    const importRunId = randomUUID();
    const orphanId = randomUUID();
    const domainIds = [randomUUID(), randomUUID()];
    const lifecycleRunId = randomUUID();

    try {
      await client.query('BEGIN');
      await client.query(readFileSync(FIXTURE_DDL_PATH, 'utf8'));
      await client.query(readFileSync(MIGRATION_PATH, 'utf8'));

      await client.query(
        `INSERT INTO public.booking_owner_setup_profiles (id, lead_id, metadata)
         VALUES ($1, $2, $3::jsonb)`,
        [ownerId, 'acceptance:channel_manager_live_core_v1', JSON.stringify({ acceptanceHarness: LIVE_CORE_ACCEPTANCE_HARNESS })],
      );
      await client.query(
        `INSERT INTO public.booking_property_setup_profiles (id, owner_setup_id, property_id, metadata)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [propertySetupId, ownerId, LIVE_CORE_ACCEPTANCE_PROPERTY_ID, JSON.stringify({ acceptanceHarness: LIVE_CORE_ACCEPTANCE_HARNESS })],
      );
      await client.query(
        `INSERT INTO public.booking_channel_manager_connections (id, property_setup_id, owner_setup_id, provider, metadata)
         VALUES ($1, $2, $3, 'manual', $4::jsonb)`,
        [connectionId, propertySetupId, ownerId, JSON.stringify({ acceptanceHarness: LIVE_CORE_ACCEPTANCE_HARNESS })],
      );
      await client.query(
        `INSERT INTO public.booking_channel_import_runs
           (id, connection_id, provider, status, import_type, created_at, started_at, finished_at)
         VALUES ($1, $2, 'manual', 'failed', 'initial_sync', $3::timestamptz, $3::timestamptz, $4::timestamptz)`,
        [importRunId, connectionId, '2026-08-05T12:44:57.498Z', '2026-08-05T12:46:20.000Z'],
      );
      await client.query(
        `INSERT INTO public.booking_ops_records
           (id, property_id, booking_id, guest_name, ota_source, reservation_metadata, created_at)
         VALUES ($1, $2, $3, $4, 'channel_manager', '{}'::jsonb, $5::timestamptz)`,
        [orphanId, LIVE_CORE_ACCEPTANCE_PROPERTY_ID, LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID, LIVE_CORE_ACCEPTANCE_GUEST_NAME, '2026-08-05T12:45:05.967Z'],
      );

      const manifest: Record<string, string[]> = { booking_ops_records: [orphanId] };
      const pushMany = async (table: string, count: number, sql: string, paramsFactory: (i: number, id: string) => unknown[]) => {
        const ids: string[] = [];
        for (let i = 0; i < count; i += 1) {
          const id = randomUUID();
          ids.push(id);
          await client.query(sql, paramsFactory(i, id));
        }
        manifest[table] = ids;
      };

      await pushMany(
        'booking_ops_events',
        LEGACY_ORPHAN_67_ROW_SHAPE.booking_ops_events,
        `INSERT INTO public.booking_ops_events (id, booking_ops_record_id) VALUES ($1, $2)`,
        (_i, id) => [id, orphanId],
      );
      await pushMany(
        'booking_ops_tasks',
        LEGACY_ORPHAN_67_ROW_SHAPE.booking_ops_tasks,
        `INSERT INTO public.booking_ops_tasks (id, booking_ops_record_id) VALUES ($1, $2)`,
        (_i, id) => [id, orphanId],
      );
      await pushMany(
        'booking_ops_communication_intents',
        LEGACY_ORPHAN_67_ROW_SHAPE.booking_ops_communication_intents,
        `INSERT INTO public.booking_ops_communication_intents (id, booking_ops_record_id) VALUES ($1, $2)`,
        (_i, id) => [id, orphanId],
      );
      await pushMany(
        'booking_ops_guest_intake_sessions',
        1,
        `INSERT INTO public.booking_ops_guest_intake_sessions (id, booking_ops_record_id) VALUES ($1, $2)`,
        (_i, id) => [id, orphanId],
      );
      await pushMany(
        'booking_ops_lifecycle_states',
        1,
        `INSERT INTO public.booking_ops_lifecycle_states (id, booking_id) VALUES ($1, $2)`,
        (_i, id) => [id, orphanId],
      );
      for (const domainId of domainIds) {
        await client.query(
          `INSERT INTO public.booking_ops_domain_events (id, booking_id, event_type, actor_type, source, correlation_id)
           VALUES ($1, $2, 'test', 'system', 'fixture', $3)`,
          [domainId, orphanId, randomUUID()],
        );
      }
      manifest.booking_ops_domain_events = domainIds;
      const decisionIds: string[] = [];
      for (const domainId of domainIds) {
        const id = randomUUID();
        decisionIds.push(id);
        await client.query(
          `INSERT INTO public.booking_ops_lifecycle_decisions
             (id, booking_id, event_id, previous_stage, next_stage, decision)
           VALUES ($1, $2, $3, 'booking_received', 'booking_received', 'synthetic')`,
          [id, orphanId, domainId],
        );
      }
      manifest.booking_ops_lifecycle_decisions = decisionIds;
      await client.query(
        `INSERT INTO public.booking_ops_lifecycle_runs (id, booking_id, run_type, status)
         VALUES ($1, $2, 'single_booking', 'completed')`,
        [lifecycleRunId, orphanId],
      );
      manifest.booking_ops_lifecycle_runs = [lifecycleRunId];
      const lifecycleEventIds: string[] = [];
      for (let i = 0; i < 5; i += 1) {
        const id = randomUUID();
        lifecycleEventIds.push(id);
        await client.query(
          `INSERT INTO public.booking_ops_lifecycle_events (id, booking_id, event_type, run_id)
           VALUES ($1, $2, $3, $4)`,
          [id, orphanId, `synthetic_${i}`, lifecycleRunId],
        );
      }
      manifest.booking_ops_lifecycle_events = lifecycleEventIds;
      await client.query(
        `INSERT INTO public.booking_ops_autopilot_states (booking_id, stage, state, last_event_id)
         VALUES ($1, 'booking_received', '{}'::jsonb, $2)`,
        [orphanId, domainIds[0]],
      );
      manifest.booking_ops_autopilot_states = [orphanId];

      const total = Object.values(manifest).reduce((sum, ids) => sum + ids.length, 0);
      expect(total).toBe(67);

      const fk = await client.query(
        `SELECT public.channel_manager_live_core_booking_ops_fk_children($1::uuid) AS payload`,
        [orphanId],
      );
      const fkPayload = fk.rows[0]?.payload as Record<string, unknown>;
      expect(fkPayload.ok).toBe(true);

      const dry = await client.query(
        `SELECT public.channel_manager_live_core_synthetic_recovery_cleanup(
           $1, true, $2::uuid, $3, $4, $5, $6::jsonb, $7::uuid, $8::uuid, $9::uuid, $10::uuid[]
         ) AS payload`,
        [
          'DRY_RUN',
          orphanId,
          LIVE_CORE_ACCEPTANCE_PROPERTY_ID,
          LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID,
          LIVE_CORE_ACCEPTANCE_GUEST_NAME,
          JSON.stringify(manifest),
          ownerId,
          propertySetupId,
          connectionId,
          [importRunId],
        ],
      );
      expect((dry.rows[0]?.payload as Record<string, unknown>).status).toBe('passed');
      expect((dry.rows[0]?.payload as Record<string, unknown>).transaction_committed).toBe(false);

      // Inject failure after earlier DELETE statements (lifecycle_runs is late in delete order).
      await client.query(`
        CREATE OR REPLACE FUNCTION public.asi_recovery_injected_fail() RETURNS trigger
        LANGUAGE plpgsql AS $fn$
        BEGIN
          RAISE EXCEPTION 'injected_failure_after_partial_deletes';
        END;
        $fn$;
        DROP TRIGGER IF EXISTS asi_recovery_injected_fail_trg ON public.booking_ops_lifecycle_runs;
        CREATE TRIGGER asi_recovery_injected_fail_trg
          BEFORE DELETE ON public.booking_ops_lifecycle_runs
          FOR EACH STATEMENT
          EXECUTE FUNCTION public.asi_recovery_injected_fail();
      `);

      const failed = await client.query(
        `SELECT public.channel_manager_live_core_synthetic_recovery_cleanup(
           $1, false, $2::uuid, $3, $4, $5, $6::jsonb, $7::uuid, $8::uuid, $9::uuid, $10::uuid[]
         ) AS payload`,
        [
          LIVE_CORE_RECOVERY_CONFIRM_PHRASE,
          orphanId,
          LIVE_CORE_ACCEPTANCE_PROPERTY_ID,
          LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID,
          LIVE_CORE_ACCEPTANCE_GUEST_NAME,
          JSON.stringify(manifest),
          ownerId,
          propertySetupId,
          connectionId,
          [importRunId],
        ],
      );
      const failedPayload = failed.rows[0]?.payload as Record<string, unknown>;
      expect(failedPayload.status).toBe('failed');
      expect(failedPayload.transaction_committed).toBe(false);
      expect(String(failedPayload.safe_error ?? '')).toMatch(/injected_failure_after_partial_deletes/);

      const stillThere = await client.query(
        `SELECT count(*)::int AS n FROM public.booking_ops_records WHERE id = $1`,
        [orphanId],
      );
      expect(stillThere.rows[0]?.n).toBe(1);
      const eventsRemain = await client.query(
        `SELECT count(*)::int AS n FROM public.booking_ops_events WHERE booking_ops_record_id = $1`,
        [orphanId],
      );
      expect(eventsRemain.rows[0]?.n).toBe(37);
      const decisionsRemain = await client.query(
        `SELECT count(*)::int AS n FROM public.booking_ops_lifecycle_decisions WHERE booking_id = $1`,
        [orphanId],
      );
      expect(decisionsRemain.rows[0]?.n).toBe(2);

      await client.query(`DROP TRIGGER IF EXISTS asi_recovery_injected_fail_trg ON public.booking_ops_lifecycle_runs`);

      const committed = await client.query(
        `SELECT public.channel_manager_live_core_synthetic_recovery_cleanup(
           $1, false, $2::uuid, $3, $4, $5, $6::jsonb, $7::uuid, $8::uuid, $9::uuid, $10::uuid[]
         ) AS payload`,
        [
          LIVE_CORE_RECOVERY_CONFIRM_PHRASE,
          orphanId,
          LIVE_CORE_ACCEPTANCE_PROPERTY_ID,
          LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID,
          LIVE_CORE_ACCEPTANCE_GUEST_NAME,
          JSON.stringify(manifest),
          ownerId,
          propertySetupId,
          connectionId,
          [importRunId],
        ],
      );
      const committedPayload = committed.rows[0]?.payload as Record<string, unknown>;
      expect(committedPayload.status).toBe('passed');
      expect(committedPayload.transaction_committed).toBe(true);
      const deleted = committedPayload.deleted_counts_by_table as Record<string, number>;
      expect(Object.values(deleted).reduce((sum, n) => sum + Number(n), 0)).toBe(67);

      const gone = await client.query(
        `SELECT count(*)::int AS n FROM public.booking_ops_records
         WHERE property_id = $1 AND booking_id = $2`,
        [LIVE_CORE_ACCEPTANCE_PROPERTY_ID, LIVE_CORE_ACCEPTANCE_EXTERNAL_BOOKING_ID],
      );
      expect(gone.rows[0]?.n).toBe(0);
      const contour = await client.query(
        `SELECT
           (SELECT count(*)::int FROM public.booking_owner_setup_profiles WHERE id = $1) AS owners,
           (SELECT count(*)::int FROM public.booking_property_setup_profiles WHERE id = $2) AS properties,
           (SELECT count(*)::int FROM public.booking_channel_manager_connections WHERE id = $3) AS connections,
           (SELECT count(*)::int FROM public.booking_channel_import_runs WHERE id = $4) AS runs`,
        [ownerId, propertySetupId, connectionId, importRunId],
      );
      expect(contour.rows[0]).toMatchObject({ owners: 1, properties: 1, connections: 1, runs: 1 });

      await client.query('ROLLBACK');
    } finally {
      await client.end().catch(() => undefined);
    }
  }, 120_000);
});
