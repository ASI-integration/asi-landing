import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDirectory = resolve(process.cwd(), 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationsDirectory)
  .filter((file) => file.endsWith('.sql'))
  .sort((left, right) => left.localeCompare(right));

const qualifiedIdentifier =
  '(?:(?:"?([a-z_][a-z0-9_]*)"?)\\s*\\.\\s*)?"?([a-z_][a-z0-9_]*)"?';
const createTablePattern = new RegExp(
  `\\bCREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${qualifiedIdentifier}`,
  'gi',
);
const referencesPattern = new RegExp(`\\bREFERENCES\\s+${qualifiedIdentifier}`, 'gi');

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
}

function canonicalTableName(schema: string | undefined, table: string): string {
  return `${schema ?? 'public'}.${table}`.toLowerCase();
}

describe('migration dependency order', () => {
  it('uses a unique numeric prefix for every migration', () => {
    const prefixes = migrationFiles.map((file) => {
      const match = file.match(/^(\d+)_/);
      expect(match, `${file} must start with a numeric prefix`).not.toBeNull();
      return match![1];
    });

    expect(new Set(prefixes).size).toBe(prefixes.length);
  });

  it('orders owner setup before channel import and its follow-up migrations', () => {
    const dependencyChain = [
      '20260701110000_owner_object_setup_autopilot_v1.sql',
      '20260701111403_channel_manager_access_import_v1.sql',
      '20260701113803_channel_manager_access_import_v1_indexes.sql',
      '20260701155640_channel_manager_provider_onboarding_v1.sql',
      '20260701170000_channel_publishing_preparation_v1.sql',
      '20260701180000_pricing_intelligence_tariff_grid_v1.sql',
    ];

    const positions = dependencyChain.map((file) => migrationFiles.indexOf(file));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it('preserves the approved partner rollout dependency order', () => {
    const dependencyChain = [
      '20260816144742_partner_property_knowledge_schema_completion_v1.sql',
      '20260815102111_partner_communication_durable_state_v1.sql',
      '20260815130000_partner_authenticated_inbox_v1.sql',
      '20260815160000_partner_communication_brain_v1.sql',
      '20260815190000_partner_service_recovery_loop_v1.sql',
      '20260815210000_partner_review_reputation_engine_v1.sql',
      '20260815230000_partner_revenue_shadow_pricing_v1.sql',
    ];

    expect(dependencyChain.every((file) => migrationFiles.includes(file))).toBe(true);
    expect(new Set(dependencyChain).size).toBe(7);
  });

  it('creates every migration-defined foreign key target before it is referenced', () => {
    const migrations = migrationFiles.map((file, fileIndex) => ({
      file,
      fileIndex,
      sql: stripSqlComments(readFileSync(resolve(migrationsDirectory, file), 'utf8')),
    }));
    const creators = new Map<string, { file: string; fileIndex: number; offset: number }>();

    for (const migration of migrations) {
      for (const match of migration.sql.matchAll(createTablePattern)) {
        const table = canonicalTableName(match[1], match[2]);
        if (!creators.has(table)) {
          creators.set(table, {
            file: migration.file,
            fileIndex: migration.fileIndex,
            offset: match.index,
          });
        }
      }
    }

    const orderingErrors: string[] = [];
    for (const migration of migrations) {
      for (const match of migration.sql.matchAll(referencesPattern)) {
        const table = canonicalTableName(match[1], match[2]);
        const creator = creators.get(table);

        if (!creator) {
          orderingErrors.push(`${migration.file}: ${table} has no CREATE TABLE migration`);
          continue;
        }

        const isCreatedEarlier =
          creator.fileIndex < migration.fileIndex ||
          (creator.fileIndex === migration.fileIndex && creator.offset < match.index);
        if (!isCreatedEarlier) {
          orderingErrors.push(
            `${migration.file}: ${table} is first created in ${creator.file}`,
          );
        }
      }
    }

    expect(orderingErrors).toEqual([]);
  });
});
