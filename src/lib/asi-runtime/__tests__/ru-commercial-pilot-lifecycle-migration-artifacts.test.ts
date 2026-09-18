import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateOwnerGate } from '../../../../scripts/agent-os/contracts.mjs';
import { loadMigrationRegistry } from '../../../../scripts/agent-os/migration-process.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const rolloutDir = path.join(repoRoot, 'docs/operations/ru-commercial-pilot-lifecycle-v1');
const workflowPath = path.join(
  repoRoot,
  '.github/workflows/apply-ru-commercial-pilot-lifecycle-v1.yml',
);
const migrationPath = 'supabase/migrations/20260918120000_ru_commercial_pilot_lifecycle_v1.sql';
const migrationAbsolutePath = path.join(repoRoot, migrationPath);
const authorizedSourceSha = 'de40e3a0f048f414c3d01440acef9b24e241f428';
const preMigrationAppSha = '7c201dd973fc56d28272443ee072b9ab43dec6cc';
const migrationBlobSha = 'b2fe7622327b0c77060dd643a42a49af180dde67';
const migrationBlobSize = 3822;
const migrationSha256 = '1313099cb86b85c494841b8e3240a11811a641c63498f5232e0fdf629ae83517';
const expectedProjectRef = 'jwinifeienvzejofmbua';
const typedConfirmation = 'APPLY_20260918120000_RU_COMMERCIAL_PILOT_LIFECYCLE_V1_TO_PRODUCTION';

type OwnerGateArtifact = {
  status: string;
  action: string;
  identity: { sha: string; migration?: string };
  allowedSideEffect: string;
  postActionVerification: string[];
  authorization: null;
  typedConfirmation: { countsAsOwnerApproval: false };
};

function readJson<T>(...parts: string[]): T {
  return JSON.parse(fs.readFileSync(path.join(...parts), 'utf8')) as T;
}

function readPinnedMigrationBlobBytes(): Buffer {
  return execSync(`git cat-file blob ${migrationBlobSha}`);
}

function sha256FromPinnedGitBlob(): string {
  return createHash('sha256').update(readPinnedMigrationBlobBytes()).digest('hex');
}

describe('RU commercial pilot lifecycle v1 production migration artifacts', () => {
  it('pins the only production migration workflow to exact repository bytes and target', () => {
    const workflowText = fs.readFileSync(workflowPath, 'utf8');

    expect(workflowText).toContain('name: Apply RU Commercial Pilot Lifecycle v1 Migration');
    expect(workflowText).toContain('AUTHORIZED_REPOSITORY: ASI-integration/asi-landing');
    expect(workflowText).toContain(`AUTHORIZED_SHA: ${authorizedSourceSha}`);
    expect(workflowText).toContain(`AUTHORIZED_PRE_MIGRATION_SHA: ${preMigrationAppSha}`);
    expect(workflowText).toContain(`AUTHORIZED_MIGRATION: ${migrationPath}`);
    expect(workflowText).toContain(`AUTHORIZED_MIGRATION_SHA256: ${migrationSha256}`);
    expect(workflowText).toContain(`AUTHORIZED_MIGRATION_BLOB: ${migrationBlobSha}`);
    expect(workflowText).toContain(`EXPECTED_SUPABASE_PROJECT_REF: ${expectedProjectRef}`);
    expect(workflowText).toContain('environment: production');
    expect(workflowText).toContain('git cat-file blob "${AUTHORIZED_SHA}:${AUTHORIZED_MIGRATION}"');
    expect(workflowText).toContain("sha256sum | awk '{print $1}'");
    expect(workflowText.match(new RegExp(`ref: ${authorizedSourceSha}`, 'g'))).toHaveLength(2);
    expect(workflowText).toContain(typedConfirmation);
    expect(workflowText).not.toMatch(/supabase\s+db\s+push/i);
    expect(workflowText).not.toMatch(/deploy\.yml|deploy-staging|confirm_production_deploy/i);
    expect(workflowText.match(/supabase\/migrations\//g)).toHaveLength(1);
  });

  it('derives the canonical Git blob SHA-256 from pinned blob bytes', () => {
    const blobBytes = readPinnedMigrationBlobBytes();
    const blobSha256 = sha256FromPinnedGitBlob();
    const workingTreeBlobSha = execSync(`git hash-object "${migrationAbsolutePath}"`)
      .toString('utf8')
      .trim();
    const sourceBlobSha = execSync(
      `git rev-parse ${authorizedSourceSha}:${migrationPath}`,
    )
      .toString('utf8')
      .trim();

    expect(blobBytes.length).toBe(migrationBlobSize);
    expect(blobSha256).toBe(migrationSha256);
    expect(workingTreeBlobSha).toBe(migrationBlobSha);
    expect(sourceBlobSha).toBe(migrationBlobSha);
    expect(createHash('sha256').update(blobBytes).digest('hex')).toBe(migrationSha256);
  });

  it('encodes explicit Data API revoke/grant privileges in the migration', () => {
    const sql = fs.readFileSync(migrationAbsolutePath, 'utf8');
    const compact = sql.replace(/\s+/g, ' ');

    expect(compact).toContain(
      'REVOKE ALL ON TABLE public.ru_commercial_pilot_lifecycle FROM PUBLIC',
    );
    expect(compact).toContain(
      'REVOKE ALL ON TABLE public.ru_commercial_pilot_lifecycle FROM anon',
    );
    expect(compact).toContain(
      'REVOKE ALL ON TABLE public.ru_commercial_pilot_lifecycle FROM authenticated',
    );
    expect(compact).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ru_commercial_pilot_lifecycle TO service_role',
    );
    expect(sql).toContain('ru_commercial_pilot_lifecycle_service_role_all');
    expect(sql).not.toMatch(/grant\s+[\s\S]*\bto\s+anon\b/i);
    expect(sql).not.toMatch(/grant\s+[\s\S]*\bto\s+authenticated\b/i);
    expect(sql).not.toMatch(/create\s+policy[\s\S]*\bto\s+anon\b/i);
    expect(sql).not.toMatch(/create\s+policy[\s\S]*\bto\s+authenticated\b/i);
  });

  it('keeps the migration owner gate pending and exact', () => {
    const migrationGate = readJson<OwnerGateArtifact>(rolloutDir, 'migration-owner-gate.json');
    const runbook = fs.readFileSync(path.join(rolloutDir, 'README.md'), 'utf8');

    expect(() => validateOwnerGate(migrationGate, null, repoRoot)).not.toThrow();
    expect(migrationGate).toMatchObject({
      status: 'missing',
      action: 'production_migration',
      identity: { sha: authorizedSourceSha, migration: migrationPath },
      authorization: null,
      typedConfirmation: { countsAsOwnerApproval: false },
    });
    expect(migrationGate.allowedSideEffect).toMatch(/checksum-pinned additive SQL migration/i);
    expect(migrationGate.allowedSideEffect).toMatch(/do not deploy the application/i);
    expect(migrationGate.postActionVerification.join('\n')).toContain(preMigrationAppSha);
    expect(runbook).toContain('STOP');
    expect(runbook).toContain(typedConfirmation);
    expect(runbook).toContain(migrationSha256);
    expect(runbook).toContain(expectedProjectRef);
    expect(runbook).toContain(authorizedSourceSha);
  });

  it('registers the exact migration as a production apply-backend mechanism', () => {
    const registry = loadMigrationRegistry(repoRoot);
    const mechanism = registry.mechanisms.find(
      (entry: { id: string }) => entry.id === 'workflow-ru-commercial-pilot-lifecycle-v1',
    );

    expect(mechanism).toMatchObject({
      kind: 'github-workflow',
      role: 'apply-backend',
      environments: ['production'],
      ownerGateRequired: true,
      supportsDryRun: false,
      rollbackPolicy: 'owner-gated-new-migration',
      migrationPaths: [migrationPath],
    });
    expect(mechanism.paths).toContain('.github/workflows/apply-ru-commercial-pilot-lifecycle-v1.yml');
    expect(mechanism.paths).toContain(
      'docs/operations/ru-commercial-pilot-lifecycle-v1/migration-owner-gate.json',
    );
  });

  it('verifies service_role CRUD, denies client roles, and emits success only after runtime checks', () => {
    const workflowText = fs.readFileSync(workflowPath, 'utf8');

    expect(workflowText).toContain('SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}');
    expect(workflowText).toContain('SUPABASE_DB_URL secret is missing.');
    expect(workflowText).toContain('SUPABASE_DB_URL project identity mismatch.');
    expect(workflowText).toContain('production_supabase_db_identity_verified=yes');
    expect(workflowText).toContain('pre_sql_identity_reverified=yes');
    expect(workflowText).toContain('db.{expected}.supabase.co');
    expect(workflowText).toContain('postgres.{expected}');
    expect(workflowText).toContain('hostname.endswith(".pooler.supabase.com")');
    expect(workflowText).toContain('psql -X "$SUPABASE_DB_URL"');
    expect(workflowText).toContain('--set ON_ERROR_STOP=1');
    expect(workflowText).toContain('--single-transaction');
    expect(workflowText).toContain("NOTIFY pgrst, 'reload schema'");
    expect(workflowText).toContain(
      "has_table_privilege('service_role', 'public.ru_commercial_pilot_lifecycle', 'SELECT')",
    );
    expect(workflowText).toContain(
      "has_table_privilege('service_role', 'public.ru_commercial_pilot_lifecycle', 'INSERT')",
    );
    expect(workflowText).toContain(
      "has_table_privilege('service_role', 'public.ru_commercial_pilot_lifecycle', 'UPDATE')",
    );
    expect(workflowText).toContain(
      "has_table_privilege('service_role', 'public.ru_commercial_pilot_lifecycle', 'DELETE')",
    );
    expect(workflowText).toContain(
      "has_table_privilege('anon', 'public.ru_commercial_pilot_lifecycle', 'SELECT')",
    );
    expect(workflowText).toContain(
      "has_table_privilege('authenticated', 'public.ru_commercial_pilot_lifecycle', 'SELECT')",
    );
    expect(workflowText).toContain(
      'anon/authenticated must not have SELECT/INSERT/UPDATE/DELETE on public.ru_commercial_pilot_lifecycle',
    );
    expect(workflowText).toContain('ru_commercial_pilot_lifecycle_pilot_after_ready_chk');
    expect(workflowText).toContain('ru_commercial_pilot_lifecycle_status_ready_at_chk');
    expect(workflowText).toContain('ru_commercial_pilot_lifecycle_status_pilot_window_chk');
    expect(workflowText).toContain('ru_commercial_pilot_lifecycle_status_completed_at_chk');
    expect(workflowText).toContain('ru_commercial_pilot_lifecycle_service_role_all');
    expect(workflowText).toContain('post_migration_runtime_unchanged=yes');
    expect(workflowText).toContain('https://asi-global.ru/api/health');
    expect(workflowText).toContain('https://asi-global.ru/api/version');

    const runtimeUnchangedIndex = workflowText.indexOf('post_migration_runtime_unchanged=yes');
    const healthOkIndex = workflowText.indexOf('post_migration_health_ok=yes');
    const successMarkerIndex = workflowText.indexOf('MIGRATION_STATUS=applied_and_verified');
    expect(healthOkIndex).toBeGreaterThan(-1);
    expect(runtimeUnchangedIndex).toBeGreaterThan(healthOkIndex);
    expect(successMarkerIndex).toBeGreaterThan(runtimeUnchangedIndex);
    expect(workflowText.match(/MIGRATION_STATUS=applied_and_verified/g)).toHaveLength(1);

    expect(workflowText).not.toMatch(/\becho\s+"\$\{?SUPABASE_DB_URL\}?"/);
    expect(workflowText).not.toMatch(/\becho\s+\$\{?SUPABASE_DB_URL\}?\b/);
    expect(workflowText).not.toMatch(/\bprintenv\b/);
    expect(workflowText).not.toMatch(/\bset\s+-x\b/);
    expect(workflowText).toContain('echo "::add-mask::${SUPABASE_DB_URL}"');
    expect(workflowText.match(/echo "::add-mask::\$\{SUPABASE_DB_URL\}"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(workflowText).not.toMatch(/supabase\s+db\s+push/i);
    expect(workflowText).not.toContain('VPS_HOST');
    expect(workflowText).not.toContain('VPS_SSH_KEY');
    expect(workflowText).not.toMatch(/secrets\.DATABASE_URL|secrets\.PRODUCTION_DATABASE_URL/);
  });
});
