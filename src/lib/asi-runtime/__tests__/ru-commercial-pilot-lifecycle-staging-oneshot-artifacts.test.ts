import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadMigrationRegistry } from '../../../../scripts/agent-os/migration-process.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const workflowPath = path.join(
  repoRoot,
  '.github/workflows/apply-staging-ru-commercial-pilot-lifecycle-v1-oneshot.yml',
);
const migrationPath = 'supabase/migrations/20260918120000_ru_commercial_pilot_lifecycle_v1.sql';
const migrationAbsolutePath = path.join(repoRoot, migrationPath);
const migrationBlobSha = 'b2fe7622327b0c77060dd643a42a49af180dde67';
const migrationSha256 = '1313099cb86b85c494841b8e3240a11811a641c63498f5232e0fdf629ae83517';
const typedConfirmation = 'APPLY_20260918120000_RU_COMMERCIAL_PILOT_LIFECYCLE_V1_TO_STAGING_ONCE';
const orphanCsv =
  '20260729040307,20260729040309,20260729040332,20260913120838,20260913120856,20260913120921,20260913120945';

describe('RU commercial pilot lifecycle v1 staging one-shot artifacts', () => {
  it('pins staging-only secrets, exact bytes, and fail-closed identity', () => {
    const workflowText = fs.readFileSync(workflowPath, 'utf8');

    expect(workflowText).toContain('name: Staging One-Shot RU Commercial Pilot Lifecycle v1');
    expect(workflowText).toContain('environment: staging');
    expect(workflowText).toContain(`AUTHORIZED_MIGRATION: ${migrationPath}`);
    expect(workflowText).toContain(`AUTHORIZED_MIGRATION_SHA256: ${migrationSha256}`);
    expect(workflowText).toContain(`AUTHORIZED_MIGRATION_BLOB: ${migrationBlobSha}`);
    expect(workflowText).toContain(typedConfirmation);
    expect(workflowText).toContain('STAGING_DATABASE_URL: ${{ secrets.STAGING_DATABASE_URL }}');
    expect(workflowText).toContain(
      'STAGING_SUPABASE_PROJECT_REF: ${{ secrets.STAGING_SUPABASE_PROJECT_REF }}',
    );
    expect(workflowText).not.toContain('STAGING_SUPABASE_URL');
    expect(workflowText).not.toContain('secrets.SUPABASE_DB_URL');
    expect(workflowText).not.toMatch(/environment:\s*production/);
    expect(workflowText).toContain('STAGING_IDENTITY_CHECK=PASS');
    expect(workflowText).toContain('db.{expected}.supabase.co');
    expect(workflowText).toContain('postgres.{expected}');
    expect(workflowText).toContain('psql -X "$STAGING_DATABASE_URL"');
    expect(workflowText).toContain('--set ON_ERROR_STOP=1');
    expect(workflowText).toContain('--single-transaction');
    expect(workflowText).toContain(`ORPHAN_REMOTE_VERSIONS: '${orphanCsv}'`);
    expect(workflowText).toContain('--file "$HISTORY_SNAPSHOT_FILE"');
    expect(workflowText).toContain("WHERE version = :'target_version'");
    expect(workflowText).toContain('ORPHAN_MIGRATION_IDS_UNTOUCHED=PASS');
    expect(workflowText).toContain('SCHEMA_MIGRATIONS_CHANGED=NO');
    expect(workflowText).toContain('schema_migrations_recording_status=unresolved_no_approved_mechanism');
    expect(workflowText).toContain('PRODUCTION_UNTOUCHED=yes');
    expect(workflowText).toContain('APP_DEPLOY=no');
    expect(workflowText).toContain('CLI_MIGRATION_PUSH=no');
    expect(workflowText).toContain('MIGRATION_REPAIR_USED=no');
    expect(workflowText).not.toMatch(/(^|[^#\w])supabase\s+db\s+push\b/im);
    expect(workflowText).not.toMatch(/\bsupabase\s+migration\s+repair\b/i);
    expect(workflowText).not.toMatch(/INSERT\s+INTO\s+supabase_migrations\.schema_migrations/i);
    expect(workflowText).not.toMatch(/deploy-staging|deploy\.yml|confirm_production_deploy/i);
    expect(workflowText).toContain('echo "::add-mask::${STAGING_DATABASE_URL}"');
    expect(workflowText).not.toMatch(/\becho\s+"\$\{?STAGING_DATABASE_URL\}?"/);
    expect(workflowText).not.toMatch(/\bprintenv\b/);
    expect(workflowText).not.toMatch(/\bset\s+-x\b/);
  });

  it('keeps the working-tree migration bytes identical to the pinned blob', () => {
    const blobBytes = execSync(`git cat-file blob ${migrationBlobSha}`);
    const workingTreeBlobSha = execSync(`git hash-object "${migrationAbsolutePath}"`)
      .toString('utf8')
      .trim();
    const sha256 = createHash('sha256').update(blobBytes).digest('hex');

    expect(workingTreeBlobSha).toBe(migrationBlobSha);
    expect(sha256).toBe(migrationSha256);
    expect(blobBytes.length).toBe(3822);
  });

  it('registers the staging one-shot as a staging apply-backend mechanism', () => {
    const registry = loadMigrationRegistry(repoRoot);
    const mechanism = registry.mechanisms.find(
      (entry: { id: string }) =>
        entry.id === 'workflow-staging-ru-commercial-pilot-lifecycle-v1-oneshot',
    );

    expect(mechanism).toMatchObject({
      kind: 'github-workflow',
      role: 'apply-backend',
      environments: ['staging'],
      ownerGateRequired: true,
      supportsDryRun: false,
      rollbackPolicy: 'owner-gated-new-migration',
      migrationPaths: [migrationPath],
    });
    expect(mechanism.paths).toContain(
      '.github/workflows/apply-staging-ru-commercial-pilot-lifecycle-v1-oneshot.yml',
    );
  });
});
