import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

const PG_URL = process.env.ASI_DISPOSABLE_POSTGRES_URL?.trim() || '';
const requireDisposablePg = process.env.ASI_REQUIRE_DISPOSABLE_PG === '1';
const hasDisposablePg = Boolean(PG_URL) && !/asi-staging|prod|production/i.test(PG_URL);

const MIGRATION_SQL = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260930200000_guest_long_term_memory_account_scope.sql'),
  'utf8',
);
const FIXTURE_SQL = readFileSync(
  resolve(process.cwd(), 'scripts/fixtures/guest-memory-tenancy-v1-pg-fixture.sql'),
  'utf8',
);
const PARTIAL_MARKER = 'CREATE UNIQUE INDEX IF NOT EXISTS uq_guest_memory_profiles_account_guest';
const partialIndex = MIGRATION_SQL.indexOf(PARTIAL_MARKER);
if (partialIndex <= 0) throw new Error('wave0_partial_migration_marker_missing');
const PARTIAL_MIGRATION_SQL = MIGRATION_SQL.slice(0, partialIndex);
type PgFailure = Error & { code?: string };

async function expectPgFailure(
  client: Client,
  sql: string,
  params: unknown[],
  expectedCode: string,
): Promise<void> {
  await client.query('SAVEPOINT wave0_expected_failure');
  let failure: PgFailure | null = null;
  try {
    await client.query(sql, params);
  } catch (error) {
    failure = error as PgFailure;
  }
  await client.query('ROLLBACK TO SAVEPOINT wave0_expected_failure');
  await client.query('RELEASE SAVEPOINT wave0_expected_failure');
  expect(failure?.code).toBe(expectedCode);
}

async function assertDisposableDatabaseClean(client: Client): Promise<void> {
  const result = await client.query(
    `SELECT to_regclass('public.guest_memory_profiles') AS profiles,
            to_regclass('public.accounts') AS accounts`,
  );
  expect(result.rows[0]).toEqual({ profiles: null, accounts: null });
}
async function withLegacyFixture(
  run: (client: Client) => Promise<void>,
): Promise<void> {
  const client = new Client({ connectionString: PG_URL });
  await client.connect();
  try {
    await assertDisposableDatabaseClean(client);
    await client.query('BEGIN');
    await client.query(FIXTURE_SQL);
    await run(client);
    await client.query('ROLLBACK');
    await assertDisposableDatabaseClean(client);
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally {
    await client.end();
  }
}

async function seedLegacyRows(
  client: Client,
  accountA: string,
  accountB: string,
  guestId: string,
): Promise<void> {
  await client.query('INSERT INTO public.accounts(id) VALUES ($1), ($2)', [accountA, accountB]);
  await client.query(
    'INSERT INTO public.tg_contacts(id) VALUES ($1), ($2)',
    [guestId, 'guest-retention'],
  );
  await client.query(
    `INSERT INTO public.guest_memory_profiles(guest_id, stay_count)
     VALUES ($1, 0)`,
    [guestId],
  );
  await client.query(
    `INSERT INTO public.guest_memory_preferences(
       guest_id, preference_key, preference_value, source_kind, source_ref
     ) VALUES ($1, 'parking', 'legacy', 'operator_confirmed', 'legacy-pref')`,
    [guestId],
  );
  await client.query(
    `INSERT INTO public.guest_memory_events(
       guest_id, event_type, summary, source_kind, source_ref, occurred_at
     ) VALUES ($1, 'maintenance_resolution', 'legacy', 'operator_confirmed', 'legacy-event', now())`,
    [guestId],
  );
}

describe('Wave 0 guest-memory PostgreSQL availability', () => {
  it('fails closed when CI requires disposable PostgreSQL', () => {
    if (!requireDisposablePg) return expect(requireDisposablePg).toBe(false);
    expect(hasDisposablePg).toBe(true);
    expect(PG_URL).toMatch(/^postgres(ql)?:\/\//i);
    expect(/asi-staging|prod|production/i.test(PG_URL)).toBe(false);
  });
  it('reports blocked rather than pretending runtime migration acceptance locally', () => {
    if (hasDisposablePg) return expect(hasDisposablePg).toBe(true);
    expect({
      status: 'BLOCKED',
      runtimeVerified: false,
      productionTouched: false,
      stagingTouched: false,
    }).toEqual({
      status: 'BLOCKED',
      runtimeVerified: false,
      productionTouched: false,
      stagingTouched: false,
    });
  });
});

describe.skipIf(!hasDisposablePg)('Wave 0 guest-memory PostgreSQL migration integration', () => {
  it('upgrades legacy data, enforces tenancy, replays safely, and recovers from partial state', async () => {
    const accountA = randomUUID();
    const accountB = randomUUID();
    const guestId = 'guest-shared';

    await withLegacyFixture(async (client) => {
      await seedLegacyRows(client, accountA, accountB, guestId);
      await client.query(MIGRATION_SQL);
      const legacy = await client.query(
        `SELECT
           (SELECT count(*)::int FROM public.guest_memory_profiles WHERE account_id IS NULL) AS profiles,
           (SELECT count(*)::int FROM public.guest_memory_preferences WHERE account_id IS NULL) AS preferences,
           (SELECT count(*)::int FROM public.guest_memory_events WHERE account_id IS NULL) AS events`,
      );
      expect(legacy.rows[0]).toEqual({ profiles: 1, preferences: 1, events: 1 });

      const checks = await client.query(
        `SELECT conname, convalidated
         FROM pg_constraint
         WHERE conname IN (
           'guest_memory_profiles_account_required',
           'guest_memory_preferences_account_required',
           'guest_memory_events_account_required'
         )
         ORDER BY conname`,
      );
      expect(checks.rows).toHaveLength(3);
      expect(checks.rows.every((row) => row.convalidated === false)).toBe(true);

      await expectPgFailure(
        client,
        'INSERT INTO public.guest_memory_profiles(guest_id) VALUES ($1)',
        [guestId],
        '23514',
      );
      await expectPgFailure(
        client,
        `UPDATE public.guest_memory_profiles
         SET stay_count = stay_count + 1
         WHERE guest_id = $1 AND account_id IS NULL`,
        [guestId],
        '23514',
      );

      await client.query(
        `INSERT INTO public.guest_memory_profiles(account_id, guest_id)
         VALUES ($1, $3), ($2, $3)`,
        [accountA, accountB, guestId],
      );
      const scopedProfiles = await client.query(
        `SELECT account_id::text, guest_id
         FROM public.guest_memory_profiles
         WHERE account_id IS NOT NULL
         ORDER BY account_id::text`,
      );
      expect(scopedProfiles.rows).toHaveLength(2);
      await client.query(
        `INSERT INTO public.guest_memory_preferences(
           account_id, guest_id, preference_key, preference_value, source_kind, source_ref
         ) VALUES
           ($1, $3, 'parking', 'A', 'operator_confirmed', 'pref-a'),
           ($2, $3, 'parking', 'B', 'operator_confirmed', 'pref-b')`,
        [accountA, accountB, guestId],
      );
      await expectPgFailure(
        client,
        `INSERT INTO public.guest_memory_preferences(
           account_id, guest_id, preference_key, preference_value, source_kind
         ) VALUES ($1, $2, 'parking', 'duplicate', 'operator_confirmed')`,
        [accountA, guestId],
        '23505',
      );

      await client.query(
        `INSERT INTO public.guest_memory_events(
           account_id, guest_id, event_type, summary, source_kind, source_ref, occurred_at
         ) VALUES
           ($1, $3, 'maintenance_resolution', 'A', 'operator_confirmed', 'shared-source', now()),
           ($2, $3, 'maintenance_resolution', 'B', 'operator_confirmed', 'shared-source', now())`,
        [accountA, accountB, guestId],
      );
      await expectPgFailure(
        client,
        `INSERT INTO public.guest_memory_events(
           account_id, guest_id, event_type, summary, source_kind, source_ref, occurred_at
         ) VALUES ($1, $2, 'maintenance_resolution', 'duplicate', 'operator_confirmed', 'shared-source', now())`,
        [accountA, guestId],
        '23505',
      );

      await client.query(
        `INSERT INTO public.guest_memory_events(
           account_id, guest_id, event_type, summary, source_kind, source_ref, occurred_at
         ) VALUES
           ($1, $3, 'completed_stay', 'stay A', 'verified_booking', 'stay-a', now()),
           ($2, $3, 'completed_stay', 'stay B', 'verified_booking', 'stay-b', now())`,
        [accountA, accountB, guestId],
      );
      const stays = await client.query(
        `SELECT account_id::text, stay_count
         FROM public.guest_memory_profiles
         WHERE guest_id = $1 AND account_id IS NOT NULL
         ORDER BY account_id::text`,
        [guestId],
      );
      expect(stays.rows.map((row) => row.stay_count)).toEqual([1, 1]);

      for (let i = 0; i < 51; i += 1) {
        await client.query(
          `INSERT INTO public.guest_memory_events(
             account_id, guest_id, event_type, summary, source_kind, source_ref, occurred_at
           ) VALUES ($1, 'guest-retention', 'maintenance_resolution', $2,
                     'deterministic_system', $3, $4)`,
          [accountA, `retention A ${i}`, `ret-a-${i}`, new Date(Date.now() + i * 1000)],
        );
      }
      await client.query(
        `INSERT INTO public.guest_memory_events(
           account_id, guest_id, event_type, summary, source_kind, source_ref, occurred_at
         ) VALUES ($1, 'guest-retention', 'maintenance_resolution', 'retention B',
                   'deterministic_system', 'ret-b-0', now())`,
        [accountB],
      );
      const retention = await client.query(
        `SELECT account_id::text, count(*)::int AS n
         FROM public.guest_memory_events
         WHERE guest_id = 'guest-retention' AND source_ref LIKE 'ret-%'
         GROUP BY account_id
         ORDER BY account_id::text`,
      );
      expect(retention.rows.map((row) => row.n).sort((a, b) => a - b)).toEqual([1, 50]);

      await client.query(MIGRATION_SQL);
      const pk = await client.query(
        `SELECT pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
         WHERE conrelid = 'public.guest_memory_profiles'::regclass AND contype = 'p'`,
      );
      expect(pk.rows).toEqual([{ definition: 'PRIMARY KEY (id)' }]);
      const indexes = await client.query(
        `SELECT
           to_regclass('public.uq_guest_memory_profiles_account_guest') IS NOT NULL AS profiles,
           to_regclass('public.uq_guest_memory_preferences_account_guest_key') IS NOT NULL AS preferences,
           to_regclass('public.uq_guest_memory_events_account_active_source') IS NOT NULL AS events`,
      );
      expect(indexes.rows[0]).toEqual({ profiles: true, preferences: true, events: true });
    });
    await withLegacyFixture(async (client) => {
      await seedLegacyRows(client, accountA, accountB, guestId);
      await client.query(PARTIAL_MIGRATION_SQL);

      const partialPk = await client.query(
        `SELECT pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
         WHERE conrelid = 'public.guest_memory_profiles'::regclass AND contype = 'p'`,
      );
      expect(partialPk.rows).toEqual([{ definition: 'PRIMARY KEY (id)' }]);

      await client.query(MIGRATION_SQL);
      await client.query(MIGRATION_SQL);

      await client.query(
        `INSERT INTO public.guest_memory_profiles(account_id, guest_id)
         VALUES ($1, $3), ($2, $3)`,
        [accountA, accountB, guestId],
      );
      const owners = await client.query(
        `SELECT count(*)::int AS n
         FROM public.guest_memory_profiles
         WHERE guest_id = $1 AND account_id IS NOT NULL`,
        [guestId],
      );
      expect(owners.rows[0]?.n).toBe(2);
    });
    console.log('ASI_WAVE0_GUEST_MEMORY_PG_PROOF', JSON.stringify({
      hasDisposablePg: true,
      runtimeVerified: true,
      legacyRowsPreserved: true,
      unscopedWritesRejected: true,
      sameGuestCrossAccountIsolated: true,
      accountScopedUniqueness: true,
      retentionScoped: true,
      completedStayScoped: true,
      migrationReplayPassed: true,
      partialStateReplayPassed: true,
      finalTransactionRolledBack: true,
      productionTouched: false,
      stagingTouched: false,
    }));
  });
});
