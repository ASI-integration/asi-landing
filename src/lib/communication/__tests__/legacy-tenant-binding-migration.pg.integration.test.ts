import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PG_URL = process.env.ASI_DISPOSABLE_POSTGRES_URL?.trim() || '';
const requireDisposablePg = process.env.ASI_REQUIRE_DISPOSABLE_PG === '1';
const hasDisposablePg = Boolean(PG_URL) && !/asi-staging|prod|production/iu.test(PG_URL);
const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260821191132_legacy_tg_property_tenant_binding_v1.sql',
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

describe('legacy tenant binding disposable PostgreSQL availability', () => {
  it('fails closed when CI requires disposable PostgreSQL but it is unavailable', () => {
    if (!requireDisposablePg) return expect(requireDisposablePg).toBe(false);
    expect(hasDisposablePg, 'legacy binding PostgreSQL integration must not skip in CI').toBe(true);
  });
});

describe.skipIf(!hasDisposablePg)('legacy tenant binding migration PostgreSQL contract', () => {
  it('applies to the canonical properties schema and enforces the composite same-account FK', async () => {
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
        CREATE TABLE public.properties (
          id UUID PRIMARY KEY,
          account_id UUID NOT NULL REFERENCES public.accounts(id)
        );
        CREATE INDEX idx_properties_account_id ON public.properties(account_id);
        CREATE TABLE public.tg_property_knowledge (
          property_id TEXT PRIMARY KEY
        );
      `);

      await client.query(readFileSync(migrationPath, 'utf8'));

      const index = await client.query(`
        SELECT i.indisunique, pg_get_indexdef(i.indexrelid) AS definition
        FROM pg_index i
        JOIN pg_class c ON c.oid = i.indexrelid
        WHERE c.relname = 'properties_account_id_id_unique'
      `);
      expect(index.rows).toHaveLength(1);
      expect(index.rows[0]).toMatchObject({ indisunique: true });
      expect(String(index.rows[0]?.definition)).toMatch(/\(account_id, id\)$/u);

      const foreignKey = await client.query(`
        SELECT pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conname = 'legacy_tg_property_bindings_account_property_fk'
      `);
      expect(foreignKey.rows).toHaveLength(1);
      expect(String(foreignKey.rows[0]?.definition)).toContain(
        'FOREIGN KEY (account_id, canonical_property_id) REFERENCES properties(account_id, id)',
      );

      await client.query(`
        INSERT INTO public.accounts (id) VALUES
          ('11111111-1111-4111-8111-111111111111'),
          ('33333333-3333-4333-8333-333333333333');
        INSERT INTO public.properties (id, account_id) VALUES
          ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111');
        INSERT INTO public.tg_property_knowledge (property_id) VALUES
          ('test-prop-tg-live'),
          ('test-prop-cross-account');
        INSERT INTO public.legacy_tg_property_bindings (
          legacy_property_id, account_id, canonical_property_id
        ) VALUES (
          'test-prop-tg-live',
          '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222'
        );
      `);

      await expect(client.query(`
        INSERT INTO public.legacy_tg_property_bindings (
          legacy_property_id, account_id, canonical_property_id
        ) VALUES (
          'test-prop-cross-account',
          '33333333-3333-4333-8333-333333333333',
          '22222222-2222-4222-8222-222222222222'
        )
      `)).rejects.toMatchObject({ code: '23503' });

      await client.query('ROLLBACK');
      transactionOpen = false;
      // eslint-disable-next-line no-console
      console.log(`LEGACY_TENANT_BINDING_PG_PROOF ${JSON.stringify({
        canonicalPropertiesPrimaryKey: 'id',
        canonicalPropertiesAccountIndexUnique: false,
        compositeUniqueIndexCreated: true,
        migrationApplied: true,
        sameAccountInsertAllowed: true,
        crossAccountInsertRejected: true,
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
