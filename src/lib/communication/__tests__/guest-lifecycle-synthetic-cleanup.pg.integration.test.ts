/**
 * Disposable PostgreSQL contract for Guest Lifecycle synthetic cleanup.
 *
 * CI supplies ASI_DISPOSABLE_POSTGRES_URL. The suite applies every repository
 * migration in order and rolls the whole database change back. It never uses
 * production or staging targets and performs no external actions.
 */

import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PG_URL = process.env.ASI_DISPOSABLE_POSTGRES_URL?.trim() || '';
const requireDisposablePg = process.env.ASI_REQUIRE_DISPOSABLE_PG === '1';
const hasDisposablePg = Boolean(PG_URL) && !/asi-staging|prod|production/iu.test(PG_URL);
const migrationsDirectory = resolve(process.cwd(), 'supabase/migrations');
const cleanupMigrationPath = join(
  migrationsDirectory,
  '20260810190000_guest_lifecycle_synthetic_cleanup_schema_fix.sql',
);

type PgClient = {
  query: (sql: string, params?: unknown[]) => Promise<{
    rows: Array<Record<string, unknown>>;
    rowCount: number | null;
  }>;
  end: () => Promise<void>;
};

const manifest = {
  token: '11111111-1111-4111-8111-111111111111',
  runId: 'glc-synthetic-11111111-1111-4111-8111-111111111111',
  bookingOpsRecordId: '22222222-2222-4222-8222-222222222222',
  reservationId: '22222222-2222-4222-8222-222222222222',
  propertyId: 'glc-synthetic-property-11111111-1111-4111-8111-111111111111',
  guestId: 'glc-synthetic-guest-11111111-1111-4111-8111-111111111111',
  guestEmail: 'glc-synthetic-11111111-1111-4111-8111-111111111111@example.invalid',
  scopeId: '33333333-3333-4333-8333-333333333333',
  policyIds: [
    '44444444-4444-4444-8444-444444444444',
    '55555555-5555-4555-8555-555555555555',
    '66666666-6666-4666-8666-666666666666',
  ],
} as const;

const cleanupColumnContract: ReadonlyArray<readonly [string, string]> = [
  ['booking_ops_records', 'id'],
  ['booking_ops_records', 'booking_id'],
  ['booking_ops_records', 'property_id'],
  ['booking_ops_records', 'reservation_metadata'],
  ['tg_guest_reservations', 'id'],
  ['tg_guest_reservations', 'booking_id'],
  ['tg_guest_reservations', 'property_id'],
  ['tg_guest_reservations', 'guest_id'],
  ['tg_guest_reservations', 'pilot_acceptance_marker'],
  ['tg_property_knowledge', 'property_id'],
  ['tg_property_knowledge', 'pilot_acceptance_marker'],
  ['tg_contacts', 'id'],
  ['tg_contacts', 'email'],
  ['tg_contacts', 'first_name'],
  ['tg_contacts', 'last_name'],
  ['tg_guest_identities', 'guest_id'],
  ['tg_guest_identities', 'email'],
  ['tg_guest_identities', 'display_name'],
  ['guest_memory_profiles', 'guest_id'],
  ['guest_memory_events', 'guest_id'],
  ['guest_memory_events', 'booking_reference'],
  ['guest_memory_events', 'event_type'],
  ['guest_memory_events', 'source_kind'],
  ['guest_lifecycle_events', 'reservation_id'],
  ['guest_lifecycle_events', 'source'],
  ['guest_lifecycle_events', 'source_event_id'],
  ['booking_ops_communication_intents', 'id'],
  ['booking_ops_communication_intents', 'booking_ops_record_id'],
  ['booking_ops_communication_intents', 'metadata'],
  ['booking_ops_communication_deliveries', 'communication_intent_id'],
  ['booking_ops_communication_auto_send_attempts', 'communication_intent_id'],
  ['booking_guest_legal_readiness', 'booking_id'],
  ['booking_guest_legal_readiness', 'property_id'],
  ['booking_guest_legal_readiness', 'metadata'],
  ['booking_cleaning_tasks', 'booking_id'],
  ['booking_linen_tasks', 'booking_id'],
  ['booking_supplies_tasks', 'booking_id'],
  ['booking_physical_readiness', 'booking_id'],
  ['booking_ops_tasks', 'booking_ops_record_id'],
  ['booking_ops_events', 'booking_ops_record_id'],
  ['booking_ops_domain_events', 'booking_id'],
  ['booking_lifecycle_gates', 'booking_id'],
  ['booking_lifecycle_exceptions', 'booking_id'],
  ['booking_ops_communication_auto_send_scopes', 'id'],
  ['booking_ops_communication_auto_send_scopes', 'scope_type'],
  ['booking_ops_communication_auto_send_scopes', 'scope_ref'],
  ['booking_ops_communication_auto_send_scopes', 'reason'],
  ['booking_ops_communication_auto_send_scopes', 'actual_send_enabled'],
  ['booking_ops_communication_auto_send_scopes', 'dry_run_only'],
  ['booking_ops_communication_policies', 'id'],
  ['booking_ops_communication_policies', 'scope'],
  ['booking_ops_communication_policies', 'scope_ref'],
  ['booking_ops_communication_policies', 'message_type'],
  ['booking_ops_communication_policies', 'channel'],
  ['booking_ops_communication_policies', 'auto_send_enabled'],
  ['booking_ops_communication_policies', 'actual_send_enabled'],
  ['booking_ops_communication_policies', 'requires_review'],
  ['booking_ops_communication_policies', 'quiet_hours_enabled'],
  ['booking_ops_communication_policies', 'max_auto_sends_per_booking_per_day'],
  ['booking_ops_communication_policies', 'max_auto_sends_per_guest_per_day'],
];

async function connectPg(): Promise<PgClient> {
  const mod = await import('pg').catch(() => null) as {
    Client: new (config: { connectionString: string }) => PgClient & { connect: () => Promise<void> };
  } | null;
  if (!mod?.Client) throw new Error('Package "pg" is required for disposable PostgreSQL integration.');
  const client = new mod.Client({ connectionString: PG_URL });
  await client.connect();
  return client;
}

async function bootstrapSupabasePrimitives(client: PgClient): Promise<void> {
  await client.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    DO $roles$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    END
    $roles$;
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS text
      LANGUAGE sql STABLE AS $fn$ SELECT 'service_role'::text $fn$;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
      LANGUAGE sql STABLE AS $fn$ SELECT NULL::uuid $fn$;
  `);
}

async function applyAllMigrations(client: PgClient): Promise<string[]> {
  const names = readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right));
  for (const name of names) {
    try {
      await client.query(readFileSync(join(migrationsDirectory, name), 'utf8'));
    } catch (error) {
      throw new Error(`migration_failed:${name}:${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return names;
}

async function callCleanup(client: PgClient, dryRun: boolean) {
  const result = await client.query(
    `SELECT public.cleanup_guest_lifecycle_synthetic_acceptance(
       $1, $2::uuid, $3, $4, $5, $6::uuid, $7::uuid[], $8,
       CASE WHEN $8 THEN 'DRY_RUN' ELSE 'CLEAN GUEST LIFECYCLE ' || $1 END
     ) AS payload`,
    [
      manifest.runId,
      manifest.bookingOpsRecordId,
      manifest.reservationId,
      manifest.propertyId,
      manifest.guestId,
      manifest.scopeId,
      [...manifest.policyIds],
      dryRun,
    ],
  );
  return result.rows[0]?.payload as Record<string, unknown>;
}

async function createExactSyntheticFixture(client: PgClient): Promise<void> {
  await client.query(`
    INSERT INTO public.tg_property_knowledge
      (property_id, location, pilot_acceptance_marker)
    VALUES ($1, 'Synthetic acceptance property', $2);

    INSERT INTO public.tg_contacts (id, email, first_name, last_name)
    VALUES ($3, $4, 'Synthetic', 'Guest');

    INSERT INTO public.tg_guest_identities
      (guest_id, email, display_name, trust_status, last_seen_at)
    VALUES ($3, $4, 'Synthetic Guest', 'normal', now());

    INSERT INTO public.guest_memory_profiles
      (guest_id, preferred_language, preferred_language_source,
       preferred_communication_mode, preferred_communication_mode_source)
    VALUES ($3, 'ru', 'deterministic_system', 'text', 'deterministic_system');

    INSERT INTO public.booking_ops_records
      (id, booking_id, property_id, guest_name, guest_email, ota_source,
       reservation_metadata)
    VALUES (
      $5::uuid, $5, $1, 'Synthetic Guest', $4, 'manual',
      jsonb_build_object(
        'acceptanceHarness', 'guest_lifecycle_communications_v1',
        'acceptanceRunId', $2,
        'synthetic', true,
        'noExternalActions', true
      )
    );

    INSERT INTO public.booking_guest_legal_readiness
      (booking_id, property_id, status, metadata)
    VALUES (
      $5::uuid, $1, 'ready_for_checkin',
      jsonb_build_object(
        'acceptanceHarness', 'guest_lifecycle_communications_v1',
        'acceptanceRunId', $2
      )
    );
    INSERT INTO public.booking_cleaning_tasks (booking_id, property_id, status)
    VALUES ($5::uuid, $1, 'verified');
    INSERT INTO public.booking_linen_tasks (booking_id, property_id, status)
    VALUES ($5::uuid, $1, 'verified');
    INSERT INTO public.booking_supplies_tasks (booking_id, property_id, status)
    VALUES ($5::uuid, $1, 'verified');
    INSERT INTO public.booking_physical_readiness
      (booking_id, property_id, status, final_ready)
    VALUES ($5::uuid, $1, 'approved', true);

    INSERT INTO public.booking_ops_tasks
      (id, booking_ops_record_id, booking_id, task_type, title)
    VALUES ($6::uuid, $5::uuid, $5, 'complete_booking_data', 'Synthetic task');
    INSERT INTO public.booking_ops_events
      (id, booking_ops_record_id, event_type, title)
    VALUES ($7::uuid, $5::uuid, 'booking_created', 'Synthetic event');
    INSERT INTO public.booking_ops_domain_events
      (id, booking_id, event_type, actor_type, source, correlation_id)
    VALUES ($8::uuid, $5::uuid, 'synthetic_acceptance', 'system', 'synthetic_acceptance', $9::uuid);
    INSERT INTO public.booking_lifecycle_gates
      (booking_id, gate_key, status, source)
    VALUES ($5, 'booking_received', 'completed', 'system');
    INSERT INTO public.booking_lifecycle_exceptions
      (booking_id, gate_key, status, reason, source)
    VALUES ($5, 'booking_received', 'open', 'Synthetic exception', 'system');

    INSERT INTO public.tg_guest_reservations
      (id, booking_id, reservation_ref, property_id, guest_id, guest_name,
       guest_contact, status, pilot_acceptance_marker)
    VALUES ($5, $5, $5, $1, $3, 'Synthetic Guest', $4, 'confirmed', $2);

    INSERT INTO public.booking_ops_communication_auto_send_scopes
      (id, scope_type, scope_ref, actual_send_enabled, enabled_by, enabled_at,
       reason, max_batch_size, allowed_channels, allowed_message_types,
       dry_run_only, emergency_stop)
    VALUES (
      $10::uuid, 'booking', $5, true, 'guest_lifecycle_communications_v1', now(),
      'guest_lifecycle_communications_v1:' || $2, 20, '["email"]'::jsonb,
      '["neutral_booking_acknowledgement","neutral_status_update","send_checkin_instructions"]'::jsonb,
      true, false
    );

    INSERT INTO public.booking_ops_communication_policies
      (id, scope, scope_ref, message_type, channel, auto_send_enabled,
       actual_send_enabled, requires_review, quiet_hours_enabled,
       max_auto_sends_per_booking_per_day, max_auto_sends_per_guest_per_day,
       allowed_recipient_roles, blocked_keywords, required_metadata)
    VALUES
      ($11::uuid, 'booking', $5, 'neutral_booking_acknowledgement', 'any', true, true, false, false, 20, 20, '["guest"]', '[]', '[]'),
      ($12::uuid, 'booking', $5, 'neutral_status_update', 'any', true, true, false, false, 20, 20, '["guest"]', '[]', '[]'),
      ($13::uuid, 'booking', $5, 'send_checkin_instructions', 'any', true, true, false, false, 20, 20, '["guest"]', '[]', '["lifecycle_event_type","identity_verified","access_allowed"]');

    INSERT INTO public.booking_ops_communication_intents
      (id, booking_ops_record_id, booking_id, actor_type, purpose, channel,
       status, message_text, message_template_key, metadata)
    VALUES (
      $14::uuid, $5::uuid, $5, 'guest', 'send_checkin_instructions', 'email',
      'completed', 'Synthetic lifecycle message', 'synthetic_lifecycle',
      jsonb_build_object(
        'lifecycle_source', 'synthetic_acceptance',
        'lifecycle_source_event_id', $2 || ':reservation.created'
      )
    );
    INSERT INTO public.booking_ops_communication_deliveries
      (id, communication_intent_id, booking_id, recipient_role, recipient_ref,
       channel, message_type, policy_decision_id, status, idempotency_key)
    VALUES (
      $15::uuid, $14::uuid, $5, 'guest', $4, 'email',
      'send_checkin_instructions', $13::uuid, 'dry_run', $2 || ':delivery'
    );
    INSERT INTO public.booking_ops_communication_auto_send_attempts
      (id, communication_intent_id, result, booking_id, guest_ref, metadata)
    VALUES ($16::uuid, $14::uuid, 'dry_run', $5, $4, '{"dry_run":true}'::jsonb);

    INSERT INTO public.guest_lifecycle_events
      (id, idempotency_key, event_type, reservation_id, booking_ops_record_id,
       property_id, guest_id, occurred_at, source, source_event_id, stage, status,
       communication_intent_id, delivery_id, payload)
    VALUES (
      $17::uuid, $2 || ':reservation.created', 'reservation.created', $5,
      $5::uuid, $1, $3, now(), 'synthetic_acceptance',
      $2 || ':reservation.created', 'reservation', 'dry_run', $14::uuid, $15::uuid,
      '{}'::jsonb
    );
    INSERT INTO public.guest_memory_events
      (id, guest_id, event_type, summary, booking_reference, source_kind,
       source_ref, occurred_at)
    VALUES (
      $18::uuid, $3, 'completed_stay', 'Synthetic completed stay.', $5,
      'deterministic_system', $2 || ':stay.completed', now()
    );
  `, [
    manifest.propertyId,
    manifest.runId,
    manifest.guestId,
    manifest.guestEmail,
    manifest.bookingOpsRecordId,
    '77777777-7777-4777-8777-777777777770',
    '77777777-7777-4777-8777-777777777771',
    '77777777-7777-4777-8777-777777777772',
    '77777777-7777-4777-8777-777777777773',
    manifest.scopeId,
    manifest.policyIds[0],
    manifest.policyIds[1],
    manifest.policyIds[2],
    '77777777-7777-4777-8777-777777777774',
    '77777777-7777-4777-8777-777777777775',
    '77777777-7777-4777-8777-777777777776',
    '77777777-7777-4777-8777-777777777777',
    '77777777-7777-4777-8777-777777777778',
  ]);
}

describe('Guest Lifecycle synthetic cleanup PostgreSQL availability', () => {
  it('fails closed when CI requires disposable PostgreSQL but it is unavailable', () => {
    if (!requireDisposablePg) return expect(requireDisposablePg).toBe(false);
    expect(hasDisposablePg, 'cleanup PostgreSQL integration must not skip in CI').toBe(true);
  });
});

describe.skipIf(!hasDisposablePg)('Guest Lifecycle synthetic cleanup PostgreSQL integration', () => {
  it('applies all migrations, validates the RPC schema, previews empty, and cleans exact lifecycle residue', async () => {
    const client = await connectPg();
    try {
      await client.query('BEGIN');
      await bootstrapSupabasePrimitives(client);
      const migrationNames = await applyAllMigrations(client);
      expect(migrationNames.at(-1)).toBe('20260810190000_guest_lifecycle_synthetic_cleanup_schema_fix.sql');

      const expectedValues = cleanupColumnContract
        .map(([table, column]) => `('${table}', '${column}')`)
        .join(',\n');
      const missingColumns = await client.query(`
        WITH expected(table_name, column_name) AS (VALUES ${expectedValues})
        SELECT expected.table_name, expected.column_name
        FROM expected
        LEFT JOIN information_schema.columns actual
          ON actual.table_schema = 'public'
         AND actual.table_name = expected.table_name
         AND actual.column_name = expected.column_name
        WHERE actual.column_name IS NULL
        ORDER BY expected.table_name, expected.column_name
      `);
      expect(missingColumns.rows).toEqual([]);

      const functionDefinition = await client.query(`
        SELECT pg_get_functiondef(
          'public.cleanup_guest_lifecycle_synthetic_acceptance(text,uuid,text,text,text,uuid,uuid[],boolean,text)'::regprocedure
        ) AS definition
      `);
      const definition = String(functionDefinition.rows[0]?.definition ?? '');
      expect(definition).toContain('delivery.communication_intent_id');
      expect(definition).toContain('attempt.communication_intent_id');
      expect(definition).not.toContain('delivery.booking_id');
      expect(definition).not.toContain('attempt.booking_id');
      expect(definition).not.toMatch(/booking_ops_communication_deliveries\s+WHERE\s+booking_id/iu);
      expect(definition).not.toMatch(/booking_ops_communication_auto_send_attempts\s+WHERE\s+booking_id/iu);

      const cleanupMigration = readFileSync(cleanupMigrationPath, 'utf8');
      expect(cleanupMigration).toContain('synthetic_manifest_identity_mismatch');
      expect(cleanupMigration).toContain('synthetic_cleanup_confirmation_mismatch');
      expect(cleanupMigration).toContain("'noExternalActions', true");

      const emptyPreview = await callCleanup(client, true);
      expect(emptyPreview).toMatchObject({
        ok: true,
        dryRun: true,
        runId: manifest.runId,
        noExternalActions: true,
      });
      expect(Object.values(emptyPreview.ownedRows as Record<string, number>))
        .toEqual(expect.arrayContaining([0]));
      expect(Object.values(emptyPreview.ownedRows as Record<string, number>).every((count) => count === 0)).toBe(true);

      await createExactSyntheticFixture(client);
      const populatedPreview = await callCleanup(client, true);
      expect(populatedPreview).toMatchObject({ ok: true, dryRun: true, noExternalActions: true });
      expect(populatedPreview.ownedRows).toMatchObject({
        bookingOpsRecords: 1,
        reservations: 1,
        lifecycleEvents: 1,
        intents: 1,
        deliveries: 1,
        attempts: 1,
        memoryEvents: 1,
        policies: 3,
      });

      const cleanup = await callCleanup(client, false);
      expect(cleanup).toMatchObject({
        ok: true,
        dryRun: false,
        runId: manifest.runId,
        residueCount: 0,
        zeroResidue: true,
        noExternalActions: true,
      });
      const finalPreview = await callCleanup(client, true);
      expect(Object.values(finalPreview.ownedRows as Record<string, number>).every((count) => count === 0)).toBe(true);

      const privileges = await client.query(`
        SELECT
          has_function_privilege('service_role',
            'public.cleanup_guest_lifecycle_synthetic_acceptance(text,uuid,text,text,text,uuid,uuid[],boolean,text)',
            'EXECUTE') AS service_role_execute,
          has_function_privilege('anon',
            'public.cleanup_guest_lifecycle_synthetic_acceptance(text,uuid,text,text,text,uuid,uuid[],boolean,text)',
            'EXECUTE') AS anon_execute,
          has_function_privilege('authenticated',
            'public.cleanup_guest_lifecycle_synthetic_acceptance(text,uuid,text,text,text,uuid,uuid[],boolean,text)',
            'EXECUTE') AS authenticated_execute
      `);
      expect(privileges.rows[0]).toMatchObject({
        service_role_execute: true,
        anon_execute: false,
        authenticated_execute: false,
      });

      const proof = {
        allMigrationsApplied: migrationNames.length,
        schemaContractColumns: cleanupColumnContract.length,
        emptyPreviewPassed: true,
        exactFixtureLifecycleResiduePassed: true,
        residueCount: cleanup.residueCount,
        zeroResidue: cleanup.zeroResidue,
        noExternalActions: cleanup.noExternalActions,
        finalTransactionRolledBack: true,
        productionTouched: false,
        stagingTouched: false,
        runNonce: randomUUID(),
      };
      // CI-grepable proof. The nonce proves execution without identifying any external target.
      // eslint-disable-next-line no-console
      console.log(`GUEST_LIFECYCLE_CLEANUP_PG_PROOF ${JSON.stringify(proof)}`);

      await client.query('ROLLBACK');
    } finally {
      await client.end().catch(() => undefined);
    }
  }, 180_000);
});
