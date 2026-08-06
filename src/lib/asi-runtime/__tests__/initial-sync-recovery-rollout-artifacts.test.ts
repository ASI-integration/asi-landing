import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateOwnerGate } from '../../../../scripts/agent-os/contracts.mjs';
import { parseRuntimeBridgeChatInput } from '../bridge-schema';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const rolloutDir = path.join(repoRoot, 'docs/operations/initial-sync-recovery-v1');
const workflowPath = path.join(
  repoRoot,
  '.github/workflows/apply-channel-manager-live-core-synthetic-recovery-migration.yml',
);
const migrationPath = 'supabase/migrations/20260805120000_channel_manager_live_core_synthetic_recovery_v1.sql';
const requiredSha = '6b9f022e423e1032f66286b9348160c4dd59f45c';
const rollbackSha = 'f5c7b91d7a6af87a07043673403aa44c56cf348a';
const migrationBlobSha = 'f56db2124b2e91782fcf05be7fb37b51998808b3';
const migrationSha256 = 'b87133906dea94b148b4778cd15006be9acec1e4cd995512ca975b12d8c69868';
const retiredMigrationSha256 = '6fbc176b21006d258d4f0253d538c46b66862f0e7752137dda62bc8a88d811ba';
const taskCycle = 'initial-sync-recovery-v1-production-rollout-20260806-r2';
const idempotencyKey = 'initial-sync-recovery-v1-6b9f022e-production-rollout-r2';

type OwnerGateArtifact = {
  status: string;
  action: string;
  identity: { sha: string; migration?: string };
  allowedSideEffect: string;
  postActionVerification: string[];
  authorization: null;
  typedConfirmation: { countsAsOwnerApproval: false };
};

type RuntimeSubmitEnvelope = {
  operation: 'runtime_submit_task';
  input: {
    chatgptTaskId: string;
    idempotencyKey: string;
    task: {
      repository: string;
      baselineSha: string;
      instructions: string[];
    };
  };
};

function readJson<T>(...parts: string[]): T {
  return JSON.parse(fs.readFileSync(path.join(...parts), 'utf8')) as T;
}

function sha256FromAuthorizedGitBlob(): string {
  const blobBytes = execSync(`git cat-file blob ${requiredSha}:${migrationPath}`);
  return createHash('sha256').update(blobBytes).digest('hex');
}

function collectActiveRolloutAuthorizationText(): string {
  return [
    fs.readFileSync(workflowPath, 'utf8'),
    fs.readFileSync(path.join(rolloutDir, 'README.md'), 'utf8'),
    fs.readFileSync(path.join(rolloutDir, 'migration-owner-gate.json'), 'utf8'),
    fs.readFileSync(path.join(rolloutDir, 'deploy-owner-gate.json'), 'utf8'),
    fs.readFileSync(path.join(rolloutDir, 'runtime-task-envelope.json'), 'utf8'),
  ].join('\n');
}

describe('Initial Sync Recovery v1 production rollout artifacts', () => {
  it('pins the only production migration workflow to exact repository bytes and target', () => {
    const workflowText = fs.readFileSync(workflowPath, 'utf8');

    expect(workflowText).toContain('name: Apply Channel Manager Live Core Synthetic Recovery v1 Migration');
    expect(workflowText).toContain('AUTHORIZED_REPOSITORY: ASI-integration/asi-landing');
    expect(workflowText).toContain(`AUTHORIZED_SHA: ${requiredSha}`);
    expect(workflowText).toContain(`AUTHORIZED_PRE_MIGRATION_SHA: ${rollbackSha}`);
    expect(workflowText).toContain(`AUTHORIZED_MIGRATION: ${migrationPath}`);
    expect(workflowText).toContain(`AUTHORIZED_MIGRATION_SHA256: ${migrationSha256}`);
    expect(workflowText).toContain(`AUTHORIZED_MIGRATION_BLOB: ${migrationBlobSha}`);
    expect(workflowText).toContain('environment: production');
    expect(workflowText).toContain('git cat-file blob "${AUTHORIZED_SHA}:${AUTHORIZED_MIGRATION}"');
    expect(workflowText).toContain('sha256sum | awk \'{print $1}\'');

    expect(workflowText.match(new RegExp(`ref: ${requiredSha}`, 'g'))).toHaveLength(2);
    expect(workflowText).toContain('APPLY_20260805120000_RECOVERY_V1_TO_PRODUCTION');
    expect(workflowText).not.toMatch(/supabase\s+db\s+push/i);
    expect(workflowText).not.toMatch(/run_initial_sync|cleanup_recovery|live-core-acceptance|deploy-staging/i);
    expect(workflowText.match(/supabase\/migrations\//g)).toHaveLength(1);
  });

  it('derives the canonical Git blob SHA-256 from authorized commit bytes', () => {
    expect(sha256FromAuthorizedGitBlob()).toBe(migrationSha256);
    expect(
      execSync(`git hash-object ${path.join(repoRoot, migrationPath)}`).toString('utf8').trim(),
    ).toBe(migrationBlobSha);
    expect(
      execSync(`git rev-parse ${requiredSha}:${migrationPath}`).toString('utf8').trim(),
    ).toBe(migrationBlobSha);
  });

  it('retires the incorrect working-tree checksum from active rollout authorization', () => {
    const rolloutText = collectActiveRolloutAuthorizationText();
    const evidence = readJson<{ failedFirstAttempt: { retiredIncorrectSha256: string } }>(
      rolloutDir,
      'read-only-evidence.json',
    );

    expect(rolloutText).toContain(migrationSha256);
    expect(rolloutText).not.toContain(retiredMigrationSha256);
    expect(evidence.failedFirstAttempt.retiredIncorrectSha256).toBe(retiredMigrationSha256);
    expect(rolloutText).toContain(requiredSha);
    expect(rolloutText).toContain(migrationPath);
    expect(rolloutText).toContain(migrationBlobSha);
    expect(rolloutText.match(new RegExp(requiredSha, 'g'))?.length).toBeGreaterThan(0);
  });

  it('keeps migration and deploy approvals atomic, pending, and exact', () => {
    const migrationGate = readJson<OwnerGateArtifact>(rolloutDir, 'migration-owner-gate.json');
    const deployGate = readJson<OwnerGateArtifact>(rolloutDir, 'deploy-owner-gate.json');

    expect(() => validateOwnerGate(migrationGate, null, repoRoot)).not.toThrow();
    expect(() => validateOwnerGate(deployGate, null, repoRoot)).not.toThrow();
    expect(migrationGate).toMatchObject({
      status: 'missing',
      action: 'production_migration',
      identity: { sha: requiredSha, migration: migrationPath },
      authorization: null,
      typedConfirmation: { countsAsOwnerApproval: false },
    });
    expect(deployGate).toMatchObject({
      status: 'missing',
      action: 'production_deploy',
      identity: { sha: requiredSha },
      authorization: null,
      typedConfirmation: { countsAsOwnerApproval: false },
    });
    expect(migrationGate.allowedSideEffect).not.toBe(deployGate.allowedSideEffect);
    expect(migrationGate.postActionVerification).not.toEqual(deployGate.postActionVerification);
  });

  it('accepts the Runtime task envelope and permits only GET preview after exact rollout phases', () => {
    const envelope = readJson<RuntimeSubmitEnvelope>(rolloutDir, 'runtime-task-envelope.json');
    const parsed = parseRuntimeBridgeChatInput(envelope);
    const instructions = envelope.input.task.instructions.join('\n') as string;

    expect(parsed).toEqual(envelope);
    expect(envelope.input.chatgptTaskId).toBe('initial-sync-recovery-v1-production-rollout-r2');
    expect(envelope.input.idempotencyKey).toBe(idempotencyKey);
    expect(envelope.input.task.repository).toBe('ASI-integration/asi-landing');
    expect(envelope.input.task.baselineSha).toBe(requiredSha);
    expect(instructions).toContain(taskCycle);
    expect(instructions).toContain('production_migration owner gate');
    expect(instructions).toContain('separate production_deploy owner gate');
    expect(instructions).toContain(`migration SHA-256 ${migrationSha256}`);
    expect(instructions).toContain('sha set to 6b9f022e423e1032f66286b9348160c4dd59f45c');
    expect(instructions).toContain('exactly one authenticated HTTP GET');
    expect(instructions).toContain(`automatic rollback to ${rollbackSha}`);
    expect(instructions).not.toContain('CLEAN_SYNTHETIC_LIVE_CORE_ACCEPTANCE_V1');
    expect(instructions).not.toContain('run_initial_sync');
    expect(JSON.stringify(envelope)).not.toMatch(/"method"\s*:\s*"POST"/i);
  });

  it('keeps the existing deployment mechanism pinned in the runbook', () => {
    const deployWorkflow = fs.readFileSync(path.join(repoRoot, '.github/workflows/deploy.yml'), 'utf8');
    const runbook = fs.readFileSync(path.join(rolloutDir, 'README.md'), 'utf8');

    expect(deployWorkflow).toContain('confirm_production_deploy');
    expect(deployWorkflow).toContain('DEPLOY_PRODUCTION');
    expect(deployWorkflow).toContain('scripts/deploy-artifact.sh');
    expect(runbook).toContain('-f sha=6b9f022e423e1032f66286b9348160c4dd59f45c');
    expect(runbook).toContain('https://asi-global.ru/api/dashboard/channel-manager/live-core-acceptance');
    expect(runbook).toContain('Do not send POST');
    expect(runbook).toContain(taskCycle);
    expect(runbook).toContain('31082052360');
  });
});
