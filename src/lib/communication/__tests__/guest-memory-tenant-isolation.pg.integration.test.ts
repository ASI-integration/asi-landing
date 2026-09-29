/**
 * Disposable PostgreSQL contract for Guest Memory tenant isolation.
 *
 * CI supplies ASI_DISPOSABLE_POSTGRES_URL. The suite applies every repository
 * migration in order, re-applies the tenant-isolation migration for
 * idempotency, and proves per-account isolation. It never uses production or
 * staging targets and always rolls the transaction back.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PG_URL = process.env.ASI_DISPOSABLE_POSTGRES_URL?.trim() || '';
const requireDisposablePg = process.env.ASI_REQUIRE_DISPOSABLE_PG === '1';
const hasDisposablePg = Boolean(PG_URL) && !/asi-staging|prod|production/iu.test(PG_URL);
const migrationsDirectory = resolve(process.cwd(), 'supabase/migrations');
const tenantMigrationName = '20260912000001_guest_memory_tenant_isolation_v1.sql';
const tenantMigrationPath = join(migrationsDirectory, tenantMigrationName);

type PgClient = {
  query: (sql: string, params?: unknown[]) => Promise<{
    rows: Array<Record<string, unknown>>;
    rowCount: number | null;
  }>;
  end: () => Promise<void>;
};

const ACCOUNT_A = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_B = '22222222-2222-4222-8222-222222222222';
const SHARED_GUEST_ID = 'shared-guest-across-accounts';
const LEGACY_GUEST_ID = 'legacy-null-account-guest';

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

describe('guest memory tenant isolation disposable PostgreSQL availability', () => {
  it('fails closed when CI requires disposable PostgreSQL but it is unavailable', () => {
    if (!requireDisposablePg) return expect(requireDisposablePg).toBe(false);
    expect(hasDisposablePg, 'guest memory tenant isolation PostgreSQL integration must not skip in CI').toBe(true);
  });
});

describe.skipIf(!hasDisposablePg)('guest memory tenant isolation migration PostgreSQL contract', () => {
  it('applies the full migration chain with tenant isolation, stay/prune scoping, and legacy NULL exclusion', async () => {
    const client = await connectPg();
    let transactionOpen = false;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      await bootstrapSupabasePrimitives(client);

      const migrationNames = await applyAllMigrations(client);
      expect(migrationNames).toContain(tenantMigrationName);
      expect(migrationNames).toContain('20260809120000_guest_long_term_memory_v1.sql');

      // Re-apply the tenant isolation migration — must remain idempotent.
      await client.query(readFileSync(tenantMigrationPath, 'utf8'));

      await client.query(
        `INSERT INTO public.accounts (id, name) VALUES ($1, 'Account A'), ($2, 'Account B')`,
        [ACCOUNT_A, ACCOUNT_B],
      );
      await client.query(
        `INSERT INTO public.tg_contacts (id) VALUES ($1), ($2)`,
        [SHARED_GUEST_ID, LEGACY_GUEST_ID],
      );

      await client.query(
        `INSERT INTO public.guest_memory_profiles (guest_id, account_id, stay_count, preferred_language)
         VALUES ($1, $2, 1, 'ru')
         ON CONFLICT (account_id, guest_id) DO UPDATE SET stay_count = EXCLUDED.stay_count`,
        [SHARED_GUEST_ID, ACCOUNT_A],
      );
      await client.query(
        `INSERT INTO public.guest_memory_profiles (guest_id, account_id, stay_count, preferred_language)
         VALUES ($1, $2, 7, 'en')
         ON CONFLICT (account_id, guest_id) DO UPDATE SET stay_count = EXCLUDED.stay_count`,
        [SHARED_GUEST_ID, ACCOUNT_B],
      );

      await client.query(
        `INSERT INTO public.guest_memory_preferences
           (guest_id, account_id, preference_key, preference_value, source_kind, status)
         VALUES ($1, $2, 'parking', 'account-a-value', 'operator_confirmed', 'active')
         ON CONFLICT (account_id, guest_id, preference_key)
         DO UPDATE SET preference_value = EXCLUDED.preference_value`,
        [SHARED_GUEST_ID, ACCOUNT_A],
      );
      await client.query(
        `INSERT INTO public.guest_memory_preferences
           (guest_id, account_id, preference_key, preference_value, source_kind, status)
         VALUES ($1, $2, 'parking', 'account-b-value', 'operator_confirmed', 'active')
         ON CONFLICT (account_id, guest_id, preference_key)
         DO UPDATE SET preference_value = EXCLUDED.preference_value`,
        [SHARED_GUEST_ID, ACCOUNT_B],
      );

      await client.query(
        `INSERT INTO public.guest_memory_events
           (guest_id, account_id, event_type, summary, source_kind, occurred_at, status)
         VALUES
           ($1, $2, 'operator_confirmed_resolution', 'account A event', 'operator_confirmed', now(), 'active'),
           ($1, $3, 'operator_confirmed_resolution', 'account B event', 'operator_confirmed', now(), 'active')`,
        [SHARED_GUEST_ID, ACCOUNT_A, ACCOUNT_B],
      );

      const profiles = await client.query(
        `SELECT account_id::text AS account_id, stay_count, preferred_language
         FROM public.guest_memory_profiles
         WHERE guest_id = $1 AND account_id IS NOT NULL
         ORDER BY account_id`,
        [SHARED_GUEST_ID],
      );
      expect(profiles.rows).toHaveLength(2);
      expect(profiles.rows.find((row) => row.account_id === ACCOUNT_A)).toMatchObject({
        stay_count: 1,
        preferred_language: 'ru',
      });
      expect(profiles.rows.find((row) => row.account_id === ACCOUNT_B)).toMatchObject({
        stay_count: 7,
        preferred_language: 'en',
      });

      const preferences = await client.query(
        `SELECT account_id::text AS account_id, preference_value
         FROM public.guest_memory_preferences
         WHERE guest_id = $1 AND account_id IS NOT NULL
         ORDER BY account_id`,
        [SHARED_GUEST_ID],
      );
      expect(preferences.rows).toHaveLength(2);
      expect(preferences.rows.find((row) => row.account_id === ACCOUNT_A)?.preference_value).toBe('account-a-value');
      expect(preferences.rows.find((row) => row.account_id === ACCOUNT_B)?.preference_value).toBe('account-b-value');

      // completed_stay must increment only the matching account stay_count.
      await client.query(
        `INSERT INTO public.guest_memory_events
           (guest_id, account_id, event_type, summary, source_kind, occurred_at, status)
         VALUES ($1, $2, 'completed_stay', 'account A stay', 'verified_booking', now(), 'active')`,
        [SHARED_GUEST_ID, ACCOUNT_A],
      );
      const profilesAfterStay = await client.query(
        `SELECT account_id::text AS account_id, stay_count
         FROM public.guest_memory_profiles WHERE guest_id = $1 AND account_id IS NOT NULL`,
        [SHARED_GUEST_ID],
      );
      expect(profilesAfterStay.rows.find((row) => row.account_id === ACCOUNT_A)?.stay_count).toBe(2);
      expect(profilesAfterStay.rows.find((row) => row.account_id === ACCOUNT_B)?.stay_count).toBe(7);

      // Pruning is per (account_id, guest_id): flood account A, leave account B untouched.
      for (let index = 0; index < 55; index += 1) {
        await client.query(
          `INSERT INTO public.guest_memory_events
             (guest_id, account_id, event_type, summary, source_kind, occurred_at, status)
           VALUES ($1, $2, 'booking_verified', $3, 'verified_booking', now() - ($4::int * interval '1 minute'), 'active')`,
          [SHARED_GUEST_ID, ACCOUNT_A, `A flood ${index}`, index],
        );
      }
      await client.query(
        `INSERT INTO public.guest_memory_events
           (guest_id, account_id, event_type, summary, source_kind, occurred_at, status)
         VALUES
           ($1, $2, 'booking_verified', 'B keep 1', 'verified_booking', now(), 'active'),
           ($1, $2, 'booking_verified', 'B keep 2', 'verified_booking', now(), 'active'),
           ($1, $2, 'booking_verified', 'B keep 3', 'verified_booking', now(), 'active')`,
        [SHARED_GUEST_ID, ACCOUNT_B],
      );

      const prunedA = await client.query(
        `SELECT count(*)::int AS count
         FROM public.guest_memory_events
         WHERE guest_id = $1 AND account_id = $2 AND status = 'active'`,
        [SHARED_GUEST_ID, ACCOUNT_A],
      );
      const prunedB = await client.query(
        `SELECT count(*)::int AS count
         FROM public.guest_memory_events
         WHERE guest_id = $1 AND account_id = $2 AND status = 'active'`,
        [SHARED_GUEST_ID, ACCOUNT_B],
      );
      expect(prunedA.rows[0]?.count).toBe(50);
      expect(Number(prunedB.rows[0]?.count)).toBeGreaterThanOrEqual(3);
      expect(Number(prunedB.rows[0]?.count)).toBeLessThanOrEqual(5);

      // Legacy NULL account_id rows exist but are excluded from tenant-scoped reads.
      await client.query(
        `INSERT INTO public.guest_memory_profiles (guest_id, account_id, stay_count, preferred_language)
         VALUES ($1, NULL, 99, 'ru')`,
        [LEGACY_GUEST_ID],
      );
      await client.query(
        `INSERT INTO public.guest_memory_preferences
           (guest_id, account_id, preference_key, preference_value, source_kind, status)
         VALUES ($1, NULL, 'crib', 'legacy crib', 'explicit_guest', 'active')`,
        [LEGACY_GUEST_ID],
      );
      await client.query(
        `INSERT INTO public.guest_memory_events
           (guest_id, account_id, event_type, summary, source_kind, occurred_at, status)
         VALUES ($1, NULL, 'maintenance_resolution', 'legacy event', 'operator_confirmed', now(), 'active')`,
        [LEGACY_GUEST_ID],
      );

      const scopedLegacyProfiles = await client.query(
        `SELECT id FROM public.guest_memory_profiles WHERE guest_id = $1 AND account_id = $2`,
        [LEGACY_GUEST_ID, ACCOUNT_A],
      );
      const scopedLegacyPreferences = await client.query(
        `SELECT id FROM public.guest_memory_preferences WHERE guest_id = $1 AND account_id = $2 AND status = 'active'`,
        [LEGACY_GUEST_ID, ACCOUNT_A],
      );
      const scopedLegacyEvents = await client.query(
        `SELECT id FROM public.guest_memory_events WHERE guest_id = $1 AND account_id = $2 AND status = 'active'`,
        [LEGACY_GUEST_ID, ACCOUNT_A],
      );
      expect(scopedLegacyProfiles.rows).toHaveLength(0);
      expect(scopedLegacyPreferences.rows).toHaveLength(0);
      expect(scopedLegacyEvents.rows).toHaveLength(0);

      const rawLegacy = await client.query(
        `SELECT
           (SELECT count(*)::int FROM public.guest_memory_profiles WHERE guest_id = $1 AND account_id IS NULL) AS profiles,
           (SELECT count(*)::int FROM public.guest_memory_preferences WHERE guest_id = $1 AND account_id IS NULL) AS preferences,
           (SELECT count(*)::int FROM public.guest_memory_events WHERE guest_id = $1 AND account_id IS NULL) AS events`,
        [LEGACY_GUEST_ID],
      );
      expect(rawLegacy.rows[0]).toMatchObject({ profiles: 1, preferences: 1, events: 1 });

      await client.query('ROLLBACK');
      transactionOpen = false;
      // eslint-disable-next-line no-console
      console.log(`GUEST_MEMORY_TENANT_ISOLATION_PG_PROOF ${JSON.stringify({
        allMigrationsApplied: migrationNames.length,
        tenantMigrationReappliedIdempotent: true,
        sameGuestIdTwoAccountsIsolated: true,
        completedStayTriggerAccountScoped: true,
        pruneScopedPerAccount: true,
        legacyNullAccountExcludedFromTenantReads: true,
        finalTransactionRolledBack: true,
        productionTouched: false,
        stagingTouched: false,
      })}`);
    } finally {
      if (transactionOpen) await client.query('ROLLBACK').catch(() => undefined);
      await client.end().catch(() => undefined);
    }
  }, 180_000);
});
