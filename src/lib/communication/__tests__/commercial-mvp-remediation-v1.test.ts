import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const route = readFileSync(
  resolve(root, 'src/app/api/admin/upsert-property-knowledge/route.ts'),
  'utf8',
);
const migration = readFileSync(
  resolve(root, 'supabase/migrations/20260819110000_commercial_mvp_property_knowledge_contract_v1.sql'),
  'utf8',
);
const workflow = readFileSync(
  resolve(root, '.github/workflows/commercial-mvp-production-repair-v1.yml'),
  'utf8',
);
const precheck = readFileSync(
  resolve(root, 'scripts/commercial-mvp-production-repair-precheck.sql'),
  'utf8',
);
const register = readFileSync(
  resolve(root, 'scripts/commercial-mvp-production-repair-register-and-verify.sql'),
  'utf8',
);

describe('Commercial MVP production remediation v1', () => {
  it('completes only the six missing communication property columns additively', () => {
    for (const column of [
      'property_policy',
      'wifi_instructions',
      'parking_instructions',
      'payment_rules',
      'upsells',
      'emergency_contacts',
    ]) {
      expect(migration).toContain(`ADD COLUMN IF NOT EXISTS ${column} TEXT`);
    }
    expect(migration).toContain("NOTIFY pgrst, 'reload schema'");
    expect(migration).not.toMatch(/\b(?:UPDATE|DELETE|TRUNCATE|DROP)\b/u);
  });

  it('maps admin check-in and checkout request names onto canonical production columns', () => {
    expect(route).toContain('row.checkin_instructions = check_in_instructions');
    expect(route).toContain('row.checkout_notes = check_out_instructions');
    expect(route).not.toContain('row.check_in_instructions');
    expect(route).not.toContain('row.check_out_instructions');
    expect(route).toContain('row.wifi_instructions =');
  });

  it('keeps repair preflight read-only and verifies the physical receipt security contract', () => {
    expect(precheck).toContain('BEGIN TRANSACTION READ ONLY;');
    expect(precheck).toContain("version = '20260817090000'");
    expect(precheck).toContain("to_regclass('public.telegram_inbound_receipts')");
    expect(precheck).toContain('relforcerowsecurity');
    expect(precheck).toContain("has_table_privilege('anon'");
    expect(precheck).toContain('prosecdef = true');
    expect(precheck).toMatch(/ROLLBACK;\s*$/u);
    expect(precheck).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE)\b/mu);
  });

  it('registers only the receipt adoption and new property-contract migration versions', () => {
    expect(register).toContain("'20260817090000'");
    expect(register).toContain("'telegram_inbound_receipts_v1'");
    expect(register).toContain("'20260819110000'");
    expect(register).toContain("'commercial_mvp_property_knowledge_contract_v1'");
    expect((register.match(/INSERT INTO supabase_migrations\.schema_migrations/g) ?? []).length).toBe(2);
    expect(register).not.toMatch(/ON\s+CONFLICT/iu);
    expect(register).not.toMatch(/\b(?:DELETE|UPDATE|TRUNCATE)\b/u);
  });

  it('requires explicit owner approval before the single production mutation', () => {
    expect(workflow).toMatch(/\bon:\s*\n\s+workflow_dispatch:/u);
    expect(workflow).toContain('operation:');
    expect(workflow).toContain('preflight');
    expect(workflow).toContain('apply');
    expect(workflow).toContain('environment: production-migration-approval');
    expect(workflow).toContain('PRODUCTION_MIGRATION_OWNER_LOGIN');
    expect(workflow).toContain('APPLY_COMMERCIAL_MVP_REPAIR_${REPAIR_SHA}');
    expect(workflow).toContain('environment: production');
    expect(workflow).toContain('--single-transaction');
    expect(workflow).toContain('20260819110000_commercial_mvp_property_knowledge_contract_v1.sql');
    expect(workflow).toContain('commercial-mvp-production-repair-register-and-verify.sql');
    expect(workflow).not.toContain('pm2 restart');
    expect(workflow).not.toContain('api.telegram.org');
  });
});
