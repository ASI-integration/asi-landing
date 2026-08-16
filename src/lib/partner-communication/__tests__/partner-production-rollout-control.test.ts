import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  EXPECTED_PARTNER_MIGRATIONS,
  validatePartnerProductionRollout,
} from '../../../../scripts/partner-production-rollout-control.mjs';

const root = process.cwd();
const workflow = readFileSync(
  resolve(root, '.github/workflows/partner-production-rollout-control-v1.yml'),
  'utf8',
);
const manifest = JSON.parse(readFileSync(
  resolve(root, 'docs/operations/partner-production-rollout-v1/manifest.json'),
  'utf8',
)) as {
  migrations: Array<{ sequence: number; filename: string; sha256: string }>;
};

describe('partner production rollout control', () => {
  it('allows exactly the seven checksum-pinned migrations in canonical order', () => {
    const expected = [
      '20260816144742_partner_property_knowledge_schema_completion_v1.sql',
      '20260815102111_partner_communication_durable_state_v1.sql',
      '20260815130000_partner_authenticated_inbox_v1.sql',
      '20260815160000_partner_communication_brain_v1.sql',
      '20260815190000_partner_service_recovery_loop_v1.sql',
      '20260815210000_partner_review_reputation_engine_v1.sql',
      '20260815230000_partner_revenue_shadow_pricing_v1.sql',
    ];
    const repositoryPartnerMigrations = readdirSync(resolve(root, 'supabase/migrations'))
      .filter((filename) => /^\d+_partner_.*\.sql$/u.test(filename));

    expect(EXPECTED_PARTNER_MIGRATIONS).toEqual(expected);
    expect(manifest.migrations.map(({ filename }) => filename)).toEqual(expected);
    expect(manifest.migrations.map(({ sequence }) => sequence)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(manifest.migrations.every(({ sha256 }) => /^[0-9a-f]{64}$/u.test(sha256))).toBe(true);
    expect(repositoryPartnerMigrations.sort()).toEqual([...expected].sort());

    const report = validatePartnerProductionRollout();
    expect(report).toMatchObject({
      migrationCount: 7,
      repositoryPartnerMigrationCount: 7,
      mutationAllowed: false,
      productionTouched: false,
      stagingTouched: false,
      secretsAccessed: false,
    });
  });

  it('is manual only and gates mutation behind owner approval', () => {
    expect(workflow).toMatch(/\bon:\s*\n\s+workflow_dispatch:/u);
    expect(workflow).not.toMatch(/^\s+(?:push|pull_request|schedule):/mu);
    expect(workflow).toContain("if: ${{ inputs.operation == 'apply' }}");
    expect(workflow).toContain('environment: production-migration-approval');
    expect(workflow).toContain('EXPECTED_OWNER_LOGIN: ${{ vars.PRODUCTION_MIGRATION_OWNER_LOGIN }}');
    expect(workflow).toContain('[[ "$GITHUB_ACTOR" == "$EXPECTED_OWNER_LOGIN" ]]');
    expect(workflow).toContain('[[ "$GITHUB_TRIGGERING_ACTOR" == "$EXPECTED_OWNER_LOGIN" ]]');
    expect(workflow).toContain('required="APPLY_PARTNER_MIGRATIONS_${ROLLOUT_SHA}"');
    expect(workflow).toContain('needs: [preflight, owner_approval]');
    expect(workflow).toContain('environment: production');
  });

  it('revalidates the exact SHA and applies the allowlist in one fail-closed transaction', () => {
    expect(workflow).toContain('--expected-sha "$ROLLOUT_SHA"');
    expect(workflow).toContain('--require-main-ancestor');
    expect(workflow).toContain('--set ON_ERROR_STOP=1');
    expect(workflow).toContain('--single-transaction');
    expect(workflow).toContain('--file scripts/partner-production-rollout-verify.sql');

    const applySection = workflow.slice(workflow.indexOf('  apply_migrations:'));
    const appliedMigrationFiles = [...applySection.matchAll(
      /--file supabase\/migrations\/([^\s\\]+\.sql)/gu,
    )].map((match) => match[1]);
    expect(appliedMigrationFiles).toEqual(EXPECTED_PARTNER_MIGRATIONS);

    let previous = -1;
    for (const filename of EXPECTED_PARTNER_MIGRATIONS) {
      const position = applySection.indexOf(`--file supabase/migrations/${filename}`);
      expect(position, filename).toBeGreaterThan(previous);
      previous = position;
    }
  });

  it('keeps database credentials inside the owner-approved mutation job', () => {
    const applyJobOffset = workflow.indexOf('  apply_migrations:');
    const firstSecretOffset = workflow.indexOf('${{ secrets.');
    expect(applyJobOffset).toBeGreaterThan(0);
    expect(firstSecretOffset).toBeGreaterThan(applyJobOffset);
    expect(workflow.slice(0, applyJobOffset)).not.toContain('${{ secrets.');
    expect(workflow.slice(0, applyJobOffset)).not.toMatch(/\bpsql\b/u);
    expect(workflow).toContain('echo "::add-mask::${SUPABASE_DB_URL}"');
    expect(workflow).not.toContain('set -x');
  });
});
