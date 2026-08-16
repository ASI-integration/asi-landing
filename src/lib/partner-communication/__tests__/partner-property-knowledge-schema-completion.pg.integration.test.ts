import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { PARTNER_STRICT_KNOWLEDGE_COLUMNS } from '../strict-property-knowledge';

const PG_URL = process.env.ASI_DISPOSABLE_POSTGRES_URL?.trim() || '';
const requireDisposablePg = process.env.ASI_REQUIRE_DISPOSABLE_PG === '1';
const hasDisposablePg = Boolean(PG_URL) && !/asi-staging|prod|production/iu.test(PG_URL);
const migrationsDirectory = resolve(process.cwd(), 'supabase', 'migrations');
const repairMigrationName = '20260816144742_partner_property_knowledge_schema_completion_v1.sql';
const repairMigrationPath = join(migrationsDirectory, repairMigrationName);
const historicalSeedMigrationName = '20260528000001_telegram_guest_memory_foundation.sql';
const expectedRepairColumns = [
  'wifi_notes',
  'door_code_notes',
  'parking_rules',
  'parking_paid_or_free',
  'parking_location_notes',
] as const;

type PgClient = {
  query: (sql: string, params?: unknown[]) => Promise<{
    rows: Array<Record<string, unknown>>;
    rowCount: number | null;
  }>;
  end: () => Promise<void>;
};

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/--.*$/gmu, '');
}

function propertyKnowledgeColumnsDeclaredByMigrationChain(): Set<string> {
  const columns = new Set<string>();
  const migrationSql = readdirSync(migrationsDirectory)
    .filter((name) => name.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right))
    .map((name) => stripSqlComments(readFileSync(join(migrationsDirectory, name), 'utf8')))
    .join('\n');

  for (const table of migrationSql.matchAll(
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?tg_property_knowledge\s*\(([\s\S]*?)\);/giu,
  )) {
    for (const definition of table[1].split(',')) {
      const column = definition.trim().match(/^([a-z_][a-z0-9_]*)\s+/iu)?.[1];
      if (column) columns.add(column.toLowerCase());
    }
  }

  for (const alteration of migrationSql.matchAll(
    /ALTER\s+TABLE\s+(?:public\.)?tg_property_knowledge\s+([\s\S]*?);/giu,
  )) {
    for (const addition of alteration[1].matchAll(
      /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)/giu,
    )) {
      columns.add(addition[1].toLowerCase());
    }
  }

  return columns;
}

async function connectPg(): Promise<PgClient> {
  const mod = await import('pg').catch(() => null) as {
    Client: new (config: { connectionString: string }) => PgClient & { connect: () => Promise<void> };
  } | null;
  if (!mod?.Client) throw new Error('Package "pg" is required for disposable PostgreSQL integration.');
  const client = new mod.Client({ connectionString: PG_URL });
  await client.connect();
  return client;
}

describe('Partner property knowledge schema completion migration', () => {
  it('adds exactly the five audited fields without data-writing statements', () => {
    const sql = stripSqlComments(readFileSync(repairMigrationPath, 'utf8'));
    const addedColumns = [...sql.matchAll(
      /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+([a-z_][a-z0-9_]*)\s+TEXT/giu,
    )].map((match) => match[1].toLowerCase());

    expect(addedColumns).toEqual(expectedRepairColumns);
    expect(sql).not.toMatch(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/iu);
    expect(sql).not.toMatch(/\b(?:mock|seed)\b/iu);
    expect(sql).not.toMatch(/\bDEFAULT\b/iu);
  });

  it('declares every strict-loader column in the canonical migration chain', () => {
    const declaredColumns = propertyKnowledgeColumnsDeclaredByMigrationChain();
    const missingColumns = PARTNER_STRICT_KNOWLEDGE_COLUMNS.filter(
      (column) => !declaredColumns.has(column),
    );

    expect(missingColumns).toEqual([]);
  });
});

describe('Partner property knowledge disposable PostgreSQL availability', () => {
  it('fails closed when CI requires disposable PostgreSQL but it is unavailable', () => {
    if (!requireDisposablePg) return expect(requireDisposablePg).toBe(false);
    expect(hasDisposablePg, 'partner property knowledge PostgreSQL integration must not skip in CI').toBe(true);
  });
});

describe.skipIf(!hasDisposablePg)('Partner property knowledge schema completion PostgreSQL integration', () => {
  it('completes the audited schema without the historical seed migration or row changes', async () => {
    const client = await connectPg();
    let transactionOpen = false;
    try {
      await client.query('BEGIN');
      transactionOpen = true;
      await client.query(`
        CREATE TABLE public.tg_property_knowledge (
          property_id TEXT PRIMARY KEY,
          active BOOLEAN NOT NULL DEFAULT true,
          wifi_name TEXT,
          wifi_password TEXT,
          checkin_instructions TEXT,
          access_notes TEXT,
          check_in_time TEXT,
          checkout_notes TEXT,
          check_out_time TEXT,
          house_rules TEXT,
          quiet_hours TEXT
        );
        INSERT INTO public.tg_property_knowledge (
          property_id, wifi_name, wifi_password, checkin_instructions, house_rules
        ) VALUES (
          'schema-repair-preservation-proof', 'existing-network', 'existing-password',
          'existing-checkin', 'existing-rules'
        );
      `);

      await client.query(readFileSync(repairMigrationPath, 'utf8'));

      const actualColumns = await client.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'tg_property_knowledge'
      `);
      const actualColumnNames = new Set(actualColumns.rows.map((row) => String(row.column_name)));
      expect(PARTNER_STRICT_KNOWLEDGE_COLUMNS.filter(
        (column) => !actualColumnNames.has(column),
      )).toEqual([]);

      const preserved = await client.query(`
        SELECT property_id, wifi_name, wifi_password, checkin_instructions, house_rules,
               wifi_notes, door_code_notes, parking_rules, parking_paid_or_free,
               parking_location_notes
        FROM public.tg_property_knowledge
        WHERE property_id = 'schema-repair-preservation-proof'
      `);
      expect(preserved.rows).toEqual([{
        property_id: 'schema-repair-preservation-proof',
        wifi_name: 'existing-network',
        wifi_password: 'existing-password',
        checkin_instructions: 'existing-checkin',
        house_rules: 'existing-rules',
        wifi_notes: null,
        door_code_notes: null,
        parking_rules: null,
        parking_paid_or_free: null,
        parking_location_notes: null,
      }]);

      await client.query('ROLLBACK');
      transactionOpen = false;
      const proof = {
        repairMigration: repairMigrationName,
        strictColumnsVerified: PARTNER_STRICT_KNOWLEDGE_COLUMNS.length,
        repairColumnsAdded: expectedRepairColumns.length,
        preservedRows: preserved.rowCount,
        historicalMigrationApplied: false,
        historicalMigrationExcluded: historicalSeedMigrationName,
        finalTransactionRolledBack: true,
        productionTouched: false,
        stagingTouched: false,
      };
      // CI-grepable proof; this integration uses only the disposable PostgreSQL service.
      // eslint-disable-next-line no-console
      console.log(`PARTNER_KNOWLEDGE_SCHEMA_PG_PROOF ${JSON.stringify(proof)}`);
    } finally {
      if (transactionOpen) await client.query('ROLLBACK').catch(() => undefined);
      await client.end().catch(() => undefined);
    }
  }, 180_000);
});
