import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20261006101500_function_search_path_hardening_v1.sql',
  ),
  'utf8',
).replace(/\r\n/g, '\n');

const EXPECTED_FUNCTIONS = [
  'set_updated_at_asi_runtime_snapshots',
  'set_updated_at_location_report_artifacts',
  'set_updated_at_location_report_deliveries',
  'set_updated_at_location_report_access_entitlements',
  'set_updated_at_location_report_requests',
  'set_guest_memory_updated_at',
  'prune_guest_memory_events',
  'normalize_guest_lifecycle_synthetic_scope_allowlist',
  'update_guest_memory_stay_profile',
] as const;

describe('Supabase function search_path hardening migration', () => {
  it('pins every currently flagged function to an empty search_path', () => {
    for (const functionName of EXPECTED_FUNCTIONS) {
      expect(migration).toContain(
        `ALTER FUNCTION public.${functionName}()\n  SET search_path TO '';`,
      );
    }
  });

  it('contains exactly the intended nine search_path changes', () => {
    const statements = migration.match(
      /ALTER FUNCTION public\.[a-z0-9_]+\(\)\s+SET search_path TO '';/g,
    ) ?? [];

    expect(statements).toHaveLength(EXPECTED_FUNCTIONS.length);

    for (const functionName of EXPECTED_FUNCTIONS) {
      const occurrences = statements.filter((statement) =>
        statement.includes(`public.${functionName}()`),
      );
      expect(occurrences).toHaveLength(1);
    }
  });

  it('does not replace function bodies, change table data, or alter privileges', () => {
    expect(migration).not.toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION/i);
    expect(migration).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/i);
    expect(migration).not.toMatch(/\b(?:GRANT|REVOKE)\b/i);
    expect(migration).not.toMatch(/ALTER\s+TABLE/i);
  });
});
