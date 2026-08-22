/**
 * Disposable PostgreSQL contract for Guest Memory tenant isolation.
 *
 * CI supplies ASI_DISPOSABLE_POSTGRES_URL. This suite builds a minimal
 * stand-in schema (base guest_memory_* tables, matching
 * 20260809120000_guest_long_term_memory_v1.sql), applies
 * 20260822000001_guest_memory_tenant_isolation_v1.sql on top of it inside a
 * transaction, and proves the two required tenant-isolation invariants
 * directly against real Postgres constraints — never against production or
 * staging, and always rolled back.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PG_URL = process.env.ASI_DISPOSABLE_POSTGRES_URL?.trim() || '';
const requireDisposablePg = process.env.ASI_REQUIRE_DISPOSABLE_PG === '1';
const hasDisposablePg = Boolean(PG_URL) && !/asi-staging|prod|production/iu.test(PG_URL);
const baseMigrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260809120000_guest_long_term_memory_v1.sql',
);
const tenantMigrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260822000001_guest_memory_tenant_isolation_v1.sql',
);

type PgClient = {
  connect: () => Promise<void>;
  query: (sql: string, params?: unknown[]) => Promise<{
    rows: Array<Record<string, unknown>>;
    rowCount: number | null;
  }>;
  end: () => Promise<void>;
};

async function connectPg(): Promise<PgClient> {
  const pg = await import('pg') as unknown as {
    Client: new (config: { connectionString: string }) => PgClient;
  };
  const client = new pg.Client({ connectionString: PG_URL });
  await client.connect();
  return client;
}

const ACCOUNT_A = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_B = '22222222-2222-4222-8222-222222222222';
const SHARED_GUEST_ID = 'shared-guest-across-accounts';

describe('guest memory tenant isolation disposable PostgreSQL availability', () => {
  it('fails closed when CI requires disposable PostgreSQL but it is unavailable', () => {
    if (!requireDisposablePg) return expect(requireDisposablePg).toBe(false);
    expect(hasDisposablePg, 'guest memory tenant isolation PostgreSQL integration must not skip in CI').toBe(true);
  });
});

describe.skipIf(!hasDisposablePg)('guest memory tenant isolation migration PostgreSQL contract', () => {
  it('isolates same guest_id across two accounts and scopes forget_all to one account', async () => {
    const client = await connectPg();
    let transactionOpen = false;
    try {
      await client.query('BEGIN');
      transactionOpen = true;

      await client.query(`
        DO $$ BEGIN
          IF to_regrole('anon') IS NULL THEN CREATE ROLE anon; END IF;
          IF to_regrole('authenticated') IS NULL THEN CREATE ROLE authenticated; END IF;
          IF to_regrole('service_role') IS NULL THEN CREATE ROLE service_role; END IF;
        END $$;
        CREATE TABLE public.accounts (
          id UUID PRIMARY KEY
        );
        CREATE TABLE public.tg_contacts (
          id TEXT PRIMARY KEY
        );
      `);

      // Apply the base migration, then the tenant-isolation migration under test.
      await client.query(readFileSync(baseMigrationPath, 'utf8'));
      await client.query(readFileSync(tenantMigrationPath, 'utf8'));

      await client.query('INSERT INTO public.accounts (id) VALUES ($1), ($2)', [ACCOUNT_A, ACCOUNT_B]);
      await client.query('INSERT INTO public.tg_contacts (id) VALUES ($1)', [SHARED_GUEST_ID]);

      // ── Profiles: same guest_id, two accounts — must coexist as two rows ──
      await client.query(
        `INSERT INTO public.guest_memory_profiles (guest_id, account_id, stay_count)
         VALUES ($1, $2, 1)
         ON CONFLICT (account_id, guest_id) DO UPDATE SET stay_count = EXCLUDED.stay_count`,
        [SHARED_GUEST_ID, ACCOUNT_A],
      );
      await client.query(
        `INSERT INTO public.guest_memory_profiles (guest_id, account_id, stay_count)
         VALUES ($1, $2, 7)
         ON CONFLICT (account_id, guest_id) DO UPDATE SET stay_count = EXCLUDED.stay_count`,
        [SHARED_GUEST_ID, ACCOUNT_B],
      );
      const profiles = await client.query(
        'SELECT account_id, stay_count FROM public.guest_memory_profiles WHERE guest_id = $1 ORDER BY account_id',
        [SHARED_GUEST_ID],
      );
      expect(profiles.rows).toHaveLength(2);
      expect(profiles.rows.find((r) => r.account_id === ACCOUNT_A)?.stay_count).toBe(1);
      expect(profiles.rows.find((r) => r.account_id === ACCOUNT_B)?.stay_count).toBe(7);

      // ── Preferences: same guest_id + key, two accounts — must coexist ──
      await client.query(
        `INSERT INTO public.guest_memory_preferences
           (guest_id, account_id, preference_key, preference_value, source_kind, status)
         VALUES ($1, $2, 'parking', 'account-a-value', 'operator_confirmed', 'active')
         ON CONFLICT (account_id, guest_id, preference_key) DO UPDATE SET preference_value = EXCLUDED.preference_value`,
        [SHARED_GUEST_ID, ACCOUNT_A],
      );
      await client.query(
        `INSERT INTO public.guest_memory_preferences
           (guest_id, account_id, preference_key, preference_value, source_kind, status)
         VALUES ($1, $2, 'parking', 'account-b-value', 'operator_confirmed', 'active')
         ON CONFLICT (account_id, guest_id, preference_key) DO UPDATE SET preference_value = EXCLUDED.preference_value`,
        [SHARED_GUEST_ID, ACCOUNT_B],
      );
      const preferences = await client.query(
        'SELECT account_id, preference_value FROM public.guest_memory_preferences WHERE guest_id = $1 ORDER BY account_id',
        [SHARED_GUEST_ID],
      );
      expect(preferences.rows).toHaveLength(2);
      expect(preferences.rows.find((r) => r.account_id === ACCOUNT_A)?.preference_value).toBe('account-a-value');
      expect(preferences.rows.find((r) => r.account_id === ACCOUNT_B)?.preference_value).toBe('account-b-value');

      // ── Events: same guest_id, two accounts — must coexist ──
      await client.query(
        `INSERT INTO public.guest_memory_events
           (guest_id, account_id, event_type, summary, source_kind, occurred_at, status)
         VALUES ($1, $2, 'operator_confirmed_resolution', 'account A event', 'operator_confirmed', now(), 'active')`,
        [SHARED_GUEST_ID, ACCOUNT_A],
      );
      await client.query(
        `INSERT INTO public.guest_memory_events
           (guest_id, account_id, event_type, summary, source_kind, occurred_at, status)
         VALUES ($1, $2, 'operator_confirmed_resolution', 'account B event', 'operator_confirmed', now(), 'active')`,
        [SHARED_GUEST_ID, ACCOUNT_B],
      );
      const eventsBefore = await client.query(
        'SELECT account_id, summary FROM public.guest_memory_events WHERE guest_id = $1 ORDER BY account_id',
        [SHARED_GUEST_ID],
      );
      expect(eventsBefore.rows).toHaveLength(2);

      // ── completed_stay trigger must only touch the matching account's profile ──
      await client.query(
        `INSERT INTO public.guest_memory_events
           (guest_id, account_id, event_type, summary, source_kind, occurred_at, status)
         VALUES ($1, $2, 'completed_stay', 'account A stay', 'verified_booking', now(), 'active')`,
        [SHARED_GUEST_ID, ACCOUNT_A],
      );
      const profilesAfterStay = await client.query(
        'SELECT account_id, stay_count FROM public.guest_memory_profiles WHERE guest_id = $1 ORDER BY account_id',
        [SHARED_GUEST_ID],
      );
      expect(profilesAfterStay.rows.find((r) => r.account_id === ACCOUNT_A)?.stay_count).toBe(2);
      expect(profilesAfterStay.rows.find((r) => r.account_id === ACCOUNT_B)?.stay_count).toBe(7);

      // ── forget_all(account A) — matches forgetGuestLongTermMemory's three deletes ──
      await client.query(
        'DELETE FROM public.guest_memory_preferences WHERE guest_id = $1 AND account_id = $2',
        [SHARED_GUEST_ID, ACCOUNT_A],
      );
      await client.query(
        'DELETE FROM public.guest_memory_events WHERE guest_id = $1 AND account_id = $2',
        [SHARED_GUEST_ID, ACCOUNT_A],
      );
      await client.query(
        'DELETE FROM public.guest_memory_profiles WHERE guest_id = $1 AND account_id = $2',
        [SHARED_GUEST_ID, ACCOUNT_A],
      );

      const profilesAfterForget = await client.query(
        'SELECT account_id FROM public.guest_memory_profiles WHERE guest_id = $1',
        [SHARED_GUEST_ID],
      );
      const preferencesAfterForget = await client.query(
        'SELECT account_id FROM public.guest_memory_preferences WHERE guest_id = $1',
        [SHARED_GUEST_ID],
      );
      const eventsAfterForget = await client.query(
        'SELECT account_id FROM public.guest_memory_events WHERE guest_id = $1',
        [SHARED_GUEST_ID],
      );

      expect(profilesAfterForget.rows.map((r) => r.account_id)).toEqual([ACCOUNT_B]);
      expect(preferencesAfterForget.rows.map((r) => r.account_id)).toEqual([ACCOUNT_B]);
      expect(new Set(eventsAfterForget.rows.map((r) => r.account_id))).toEqual(new Set([ACCOUNT_B]));

      await client.query('ROLLBACK');
      transactionOpen = false;
      // eslint-disable-next-line no-console
      console.log(`GUEST_MEMORY_TENANT_ISOLATION_PG_PROOF ${JSON.stringify({
        migrationApplied: true,
        profilesCompositeUniqueEnforced: true,
        sameGuestIdTwoAccountsIsolated: true,
        completedStayTriggerAccountScoped: true,
        forgetAllScopedToOneAccount: true,
        finalTransactionRolledBack: true,
        productionTouched: false,
        stagingTouched: false,
      })}`);
    } finally {
      if (transactionOpen) await client.query('ROLLBACK').catch(() => undefined);
      await client.end().catch(() => undefined);
    }
  }, 60_000);
});
