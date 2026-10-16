/** Real RPC concurrency regression on an exclusively owned disposable database. */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pgUrl = process.env.ASI_DISPOSABLE_POSTGRES_URL?.trim() || '';
const required = process.env.ASI_REQUIRE_DISPOSABLE_PG === '1';
function localDisposableUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      && !/asi-staging|prod|production/iu.test(value);
  } catch { return false; }
}
const available = localDisposableUrl(pgUrl);
type Client = {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  end: () => Promise<void>;
};
async function connect(url: string): Promise<Client> {
  const pg = await import('pg') as unknown as {
    Client: new (options: { connectionString: string }) => Client & { connect: () => Promise<void> };
  };
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}
const sqlRoot = resolve(process.cwd(), 'scripts/strigunov4/availability-lock');
function pinned(path: string, digest: string): string {
  const sql = readFileSync(path, 'utf8').replace(/\r\n/gu, '\n');
  expect(createHash('sha256').update(sql).digest('hex')).toBe(digest);
  return sql;
}
const rpc = `SELECT public.create_booking_availability_hold_atomic_account_v1(
  '11111111-1111-4111-8111-111111111111', $1::uuid, $2::text, NULL,
  'internal', '2030-01-01', '2030-01-03', NULL, 'Synthetic concurrency fixture', '{}', $3
)->>'status' AS status`;
async function race(url: string, control: Client, fixed: boolean): Promise<void> {
  await control.query('TRUNCATE public.booking_availability_holds, public.booking_overbooking_conflict_checks');
  const a = await connect(url);
  let b: Client | undefined;
  let second: Promise<Awaited<ReturnType<Client['query']>>> | undefined;
  try {
    b = await connect(url);
    await a.query("BEGIN ISOLATION LEVEL READ COMMITTED; SET LOCAL ROLE service_role; SET LOCAL statement_timeout='8s'");
    await b.query("BEGIN ISOLATION LEVEL READ COMMITTED; SET LOCAL ROLE service_role; SET LOCAL statement_timeout='8s'");
    const aPid = (await a.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const bPid = (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    expect((await a.query(rpc, ['33333333-3333-4333-8333-333333333333', null, 'setup-call'])).rows[0].status).toBe('active');
    let settled = false;
    second = b.query(rpc, [null, '22222222-2222-4222-8222-222222222222', 'property-call']);
    void second.then(() => { settled = true; }, () => { settled = true; });
    if (fixed) {
      let waited = false;
      for (let attempt = 0; attempt < 60 && !settled; attempt += 1) {
        const row = (await control.query(
          "SELECT wait_event_type, wait_event FROM pg_stat_activity WHERE pid=$1", [bPid],
        )).rows[0];
        if (row?.wait_event_type === 'Lock' && row.wait_event === 'advisory') { waited = true; break; }
        await new Promise((done) => setTimeout(done, 25));
      }
      expect(waited).toBe(true);
      expect(settled).toBe(false);
      await a.query('COMMIT');
      expect((await second).rows[0].status).toBe('conflict');
      await b.query('COMMIT');
    } else {
      expect((await second).rows[0].status).toBe('active');
      await b.query('COMMIT');
      expect((await control.query('SELECT state FROM pg_stat_activity WHERE pid=$1', [aPid])).rows[0].state).toBe('idle in transaction');
      await a.query('COMMIT');
    }
  } finally {
    await a.query('ROLLBACK').catch(() => undefined);
    if (second) await second.catch(() => undefined);
    if (b) { await b.query('ROLLBACK').catch(() => undefined); await b.end(); }
    await a.end();
  }
}

describe('Availability canonical lock PostgreSQL availability', () => {
  it('fails closed when CI requires the local disposable PostgreSQL service', () => {
    if (required) expect(available).toBe(true);
  });
});
describe.skipIf(!available)('Availability canonical lock PostgreSQL integration', () => {
  it('reproduces old overlap, then serializes setup and property inputs with the forward correction', async () => {
    const database = `asi_lock_${randomUUID().replace(/-/gu, '')}`;
    const url = new URL(pgUrl); url.pathname = `/${database}`;
    const admin = await connect(pgUrl);
    let client: Client | undefined;
    let created = false;
    try {
      const serverVersion = Number((await admin.query('SHOW server_version_num')).rows[0].server_version_num);
      expect(serverVersion).toBeGreaterThanOrEqual(170000);
      expect(serverVersion).toBeLessThan(180000);
      await admin.query(`CREATE DATABASE "${database}"`); created = true;
      client = await connect(url.toString());
      const schema = pinned(resolve(sqlRoot, 'synthetic-schema.sql'), 'c1dc98a1a3fb8d8421059b3e4a57b2274b456db1244dcc3a0663dee992aa17a1');
      // Roles are cluster-wide and shared with the established disposable PG harness.
      const roleBootstrap = `DO $roles$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
      END $roles$;`;
      await client.query(roleBootstrap + schema.replace(/^CREATE ROLE (anon|authenticated|service_role);\n/gmu, ''));
      await client.query(pinned(resolve(sqlRoot, 'old-function.sql'), '3cfe8b6a5c47996f8159739b4efb2e22dd9be150fc1f63613b067302676c551c'));
      await race(url.toString(), client, false);
      const metadata = "SELECT proowner,proacl FROM pg_proc WHERE proname='create_booking_availability_hold_atomic_account_v1'";
      const before = (await client.query(metadata)).rows;
      await client.query(pinned(resolve(process.cwd(), 'supabase/migrations/20261016203000_booking_availability_canonical_lock.sql'), '782c83e99c20ef8882f7b6e428ad9287fd5b5d417f92697d98ef79c0da1f878c'));
      expect((await client.query(metadata)).rows).toEqual(before);
      await race(url.toString(), client, true);
    } finally {
      if (client) await client.end();
      try {
        if (created) {
          const owner = await admin.query('SELECT pg_get_userbyid(datdba)=current_user AS owned FROM pg_database WHERE datname=$1', [database]);
          expect(owner.rows[0]?.owned).toBe(true);
          await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
        }
      } finally { await admin.end(); }
    }
  }, 30_000);
});
