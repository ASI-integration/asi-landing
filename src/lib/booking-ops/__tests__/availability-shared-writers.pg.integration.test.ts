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
const account = '11111111-1111-4111-8111-111111111111';
const property = '22222222-2222-4222-8222-222222222222';
const setup = '33333333-3333-4333-8333-333333333333';
type Writer = 'legacy' | 'canonical' | 'ledger-unit' | 'ledger-property' | 'ledger-other-unit';
type Call = { sql: string; values: unknown[] };
function writerCall(writer: Writer, key: string): Call {
  if (writer === 'legacy') return {
    sql: `SELECT public.create_booking_availability_hold_atomic($1::uuid,NULL,NULL,'internal',
      '2030-01-01','2030-01-03',NULL,'Synthetic shared-writer fixture','{}',$2) AS result`,
    values: [setup, key],
  };
  if (writer === 'canonical') return {
    sql: `SELECT public.create_booking_availability_hold_atomic_account_v1($1,NULL,$2,NULL,'internal',
      '2030-01-01','2030-01-03',NULL,'Synthetic shared-writer fixture','{}',$3) AS result`,
    values: [account, property, key],
  };
  return {
    sql: `SELECT public.reserve_canonical_availability_atomic($1,$2,$3,
      '2030-01-01','2030-01-03',$4,NULL) AS result`,
    values: [account, property, writer === 'ledger-property' ? null : writer === 'ledger-other-unit' ? 'unit-b' : 'unit-a', key],
  };
}
function accepted(row: Record<string, unknown>): boolean {
  const result = row.result as Record<string, unknown>;
  return result.status === 'active' || result.ok === true;
}
function rejected(row: Record<string, unknown>): boolean {
  const result = row.result as Record<string, unknown>;
  return result.status === 'conflict' || result.ok === false;
}
async function crossWriterRace(url: string, control: Client, first: Writer, next: Writer, fixed: boolean, independentUnits = false): Promise<void> {
  await control.query('TRUNCATE public.booking_availability_holds, public.booking_overbooking_conflict_checks');
  const a = await connect(url);
  let b: Client | undefined;
  let pending: Promise<Awaited<ReturnType<Client['query']>>> | undefined;
  try {
    b = await connect(url);
    for (const client of [a, b]) await client.query("BEGIN ISOLATION LEVEL READ COMMITTED; SET LOCAL ROLE service_role; SET LOCAL statement_timeout='8s'");
    const aPid = (await a.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const bPid = (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    const firstCall = writerCall(first, `${account}:${first}:first`);
    const firstRow = (await a.query(firstCall.sql, firstCall.values)).rows[0];
    expect(accepted(firstRow)).toBe(true);
    if (first === 'legacy') {
      const result = firstRow.result as Record<string, unknown>;
      expect(result.account_id).toBe(fixed ? account : null);
      expect(result.property_id).toBe(fixed ? property : null);
    }
    const nextCall = writerCall(next, `${account}:${next}:second`);
    let settled = false;
    pending = b.query(nextCall.sql, nextCall.values);
    void pending.then(() => { settled = true; }, () => { settled = true; });
    if (fixed) {
      let waiting = false;
      for (let attempt = 0; attempt < 80 && !settled; attempt += 1) {
        const row = (await control.query('SELECT wait_event_type,wait_event FROM pg_stat_activity WHERE pid=$1', [bPid])).rows[0];
        if (row?.wait_event_type === 'Lock' && row.wait_event === 'advisory') { waiting = true; break; }
        await new Promise((done) => setTimeout(done, 25));
      }
      expect(waiting).toBe(true);
      expect(settled).toBe(false);
      await a.query('COMMIT');
      const secondRow = (await pending).rows[0];
      expect(independentUnits ? accepted(secondRow) : rejected(secondRow)).toBe(true);
      if (next === 'legacy') expect((secondRow.result as Record<string, unknown>).account_id).toBe(account);
      await b.query('COMMIT');
    } else {
      expect(accepted((await pending).rows[0])).toBe(true);
      await b.query('COMMIT');
      expect((await control.query('SELECT state FROM pg_stat_activity WHERE pid=$1', [aPid])).rows[0].state).toBe('idle in transaction');
      await a.query('COMMIT');
    }
  } finally {
    await a.query('ROLLBACK').catch(() => undefined);
    if (pending) await pending.catch(() => undefined);
    if (b) { await b.query('ROLLBACK').catch(() => undefined); await b.end(); }
    await a.end();
  }
}
async function denyLegacy(client: Client, setupId: string | null, propertyId: string | null, state: string): Promise<void> {
  await client.query('BEGIN; SET LOCAL ROLE service_role');
  try {
    await expect(client.query(`SELECT public.create_booking_availability_hold_atomic($1::uuid,$2,NULL,
      'internal','2030-01-01','2030-01-03',NULL,'Synthetic denial','{}',$3)`,
    [setupId, propertyId, `${account}:denied:${randomUUID()}`])).rejects.toMatchObject({ code: state });
  } finally { await client.query('ROLLBACK'); }
}

describe('Availability shared writers PostgreSQL availability', () => {
  it('requires the loopback disposable PostgreSQL service in CI', () => {
    if (required) expect(available).toBe(true);
  });
});
describe.skipIf(!available)('Availability shared writers PostgreSQL integration', () => {
  it('serializes reviewed writer pairs while preserving unit filtering and resolving legacy account lineage', async () => {
    const database = `asi_writers_${randomUUID().replace(/-/gu, '')}`;
    const url = new URL(pgUrl); url.pathname = `/${database}`;
    const admin = await connect(pgUrl);
    let client: Client | undefined;
    let created = false;
    try {
      const version = Number((await admin.query('SHOW server_version_num')).rows[0].server_version_num);
      expect(version).toBeGreaterThanOrEqual(170000); expect(version).toBeLessThan(180000);
      await admin.query(`CREATE DATABASE "${database}"`); created = true;
      client = await connect(url.toString());
      await client.query(`DO $roles$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
      END $roles$;`);
      await client.query(pinned(resolve(sqlRoot, 'synthetic-schema.sql'), 'c1dc98a1a3fb8d8421059b3e4a57b2274b456db1244dcc3a0663dee992aa17a1').replace(/^CREATE ROLE (anon|authenticated|service_role);\n/gmu, ''));
      await client.query(`ALTER TABLE public.booking_availability_holds ADD COLUMN unit_id text;
        ALTER TABLE public.booking_availability_blocks ADD COLUMN unit_id text, ADD COLUMN block_type text, ADD COLUMN property_setup_id uuid;
        ALTER TABLE public.booking_ops_records ADD COLUMN unit_id text, ADD COLUMN normalized_status text, ADD COLUMN asi_reference text;
        ALTER TABLE public.booking_channel_imported_objects ADD COLUMN matched_property_setup_id uuid;`);
      await client.query(pinned(resolve(sqlRoot, 'old-function.sql'), '3cfe8b6a5c47996f8159739b4efb2e22dd9be150fc1f63613b067302676c551c'));
      await client.query(pinned(resolve(process.cwd(), 'supabase/migrations/20261016203000_booking_availability_canonical_lock.sql'), '782c83e99c20ef8882f7b6e428ad9287fd5b5d417f92697d98ef79c0da1f878c'));
      await client.query(pinned(resolve(sqlRoot, 'legacy-function-before-shared-lock.sql'), '6ff7f9495ec23b38f88432b303cb928f670f73ac09d768b431681b995937481d'));
      await client.query(pinned(resolve(sqlRoot, 'ledger-function-before-shared-lock.sql'), '0203d9065c1c7c35e273051f6d4e404ee1be3b4088cdbc192e42a2c16c13395d'));
      const pairs: Array<[Writer, Writer]> = [
        ['legacy', 'canonical'], ['canonical', 'legacy'], ['ledger-unit', 'canonical'],
        ['canonical', 'ledger-unit'], ['ledger-unit', 'ledger-property'], ['ledger-property', 'ledger-unit'],
      ];
      for (const [first, next] of pairs) await crossWriterRace(url.toString(), client, first, next, false);
      const metadata = `SELECT proname,proowner,proacl FROM pg_proc WHERE proname IN
        ('create_booking_availability_hold_atomic','create_booking_availability_hold_atomic_account_v1','reserve_canonical_availability_atomic') ORDER BY proname`;
      const before = (await client.query(metadata)).rows;
      await client.query(pinned(resolve(process.cwd(), 'supabase/migrations/20261016213000_booking_availability_shared_writer_lock.sql'), '08975e5a7e7755f80c128bd5c74c5ad1a45633b353b997bfb42c188f7471e27a'));
      expect((await client.query(metadata)).rows).toEqual(before);
      for (const [first, next] of pairs) await crossWriterRace(url.toString(), client, first, next, true);
      await crossWriterRace(url.toString(), client, 'ledger-unit', 'ledger-other-unit', true, true);
      await client.query('TRUNCATE public.booking_availability_holds, public.booking_overbooking_conflict_checks');
      await denyLegacy(client, null, null, '22023');
      await denyLegacy(client, '44444444-4444-4444-8444-444444444444', null, '42501');
      await denyLegacy(client, setup, '44444444-4444-4444-8444-444444444444', '42501');
      await denyLegacy(client, null, '44444444-4444-4444-8444-444444444444', '42501');
      expect((await client.query('SELECT count(*)::int AS n FROM public.booking_availability_holds')).rows[0].n).toBe(0);
      expect((await client.query('SELECT count(*)::int AS n FROM public.booking_overbooking_conflict_checks')).rows[0].n).toBe(0);
    } finally {
      if (client) await client.end();
      try {
        if (created) {
          expect((await admin.query('SELECT pg_get_userbyid(datdba)=current_user AS owned FROM pg_database WHERE datname=$1', [database])).rows[0]?.owned).toBe(true);
          await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
        }
      } finally { await admin.end(); }
    }
  }, 45_000);
});
