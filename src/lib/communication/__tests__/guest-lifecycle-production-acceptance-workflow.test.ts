import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(join(
  process.cwd(),
  '.github/workflows/guest-lifecycle-production-acceptance.yml',
), 'utf8');

describe('guest lifecycle production acceptance workflow', () => {
  it('is manual-only and requires all exact owner-gate inputs', () => {
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).not.toMatch(/^\s*(push|pull_request|schedule):/mu);
    for (const input of [
      'expected_production_sha',
      'verified_target_id',
      'expected_target_id',
      'safety_acknowledgement',
    ]) {
      expect(workflow).toMatch(new RegExp(`^      ${input}:\\n(?:        .+\\n)*?        required: true$`, 'mu'));
    }
    expect(workflow).toContain("REQUIRED_ACK='RUN ISOLATED GUEST LIFECYCLE SYNTHETIC ACCEPTANCE'");
    expect(workflow).toContain('environment: production');
  });

  it('checks out and verifies the exact deployed main revision before bundling', () => {
    expect(workflow).toContain('ref: ${{ inputs.expected_production_sha }}');
    expect(workflow).toContain('[[ "$CHECKED_OUT_SHA" != "$EXPECTED_PRODUCTION_SHA" ]]');
    expect(workflow).toContain('git merge-base --is-ancestor "$CHECKED_OUT_SHA" origin/main');
    expect(workflow).toContain('npm exec --yes --package=esbuild@0.25.9 -- esbuild');
    expect(workflow).toContain('--bundle');
    expect(workflow).toContain('--platform=node');
    expect(workflow).toContain('--format=cjs');
    expect(workflow).toContain('spawnSync(process.execPath');
    expect(workflow).toContain("node --check \"$ARTIFACT\"");
    expect(workflow).toContain('acceptance_not_enabled');
  });

  it('uses the established production SSH and env seams with two cleanup traps', () => {
    expect(workflow).toContain('VPS_HOST: ${{ secrets.VPS_HOST }}');
    expect(workflow).toContain('VPS_PORT: ${{ secrets.VPS_PORT }}');
    expect(workflow).toContain('VPS_SSH_KEY: ${{ secrets.VPS_SSH_KEY }}');
    expect(workflow).toContain("REMOTE_USER='project_ayfaar'");
    expect(workflow).toContain("ENV_FILE='/var/www/asi/shared/.env.production.live'");
    expect(workflow).toContain('source "$ENV_FILE"');
    expect(workflow).toContain('trap cleanup_remote EXIT');
    expect(workflow).toContain("trap 'rm -rf -- \"$ACCEPTANCE_TMP\"' EXIT");
    expect(workflow).toContain('mktemp -d /home/project_ayfaar/guest-lifecycle-production-acceptance.XXXXXX');
    expect(workflow).not.toContain('npm install');
    expect(workflow).not.toContain('npm prune');
  });

  it('sets only the five acceptance gates and emits the required result contract', () => {
    const exportedGates = [...workflow.matchAll(/^          export (GUEST_LIFECYCLE_ACCEPTANCE_[A-Z_]+)=/gmu)]
      .map((match) => match[1]);
    expect(exportedGates).toEqual([
      'GUEST_LIFECYCLE_ACCEPTANCE_ENABLED',
      'GUEST_LIFECYCLE_ACCEPTANCE_CONFIRM',
      'GUEST_LIFECYCLE_ACCEPTANCE_NO_EXTERNAL_ACTIONS',
      'GUEST_LIFECYCLE_ACCEPTANCE_TARGET_ID',
      'GUEST_LIFECYCLE_ACCEPTANCE_EXPECTED_TARGET_ID',
    ]);
    for (const field of [
      'deployedShaVerified',
      'lifecycleEventsCreated',
      'dryRunDeliveries',
      'sameProcessReplayDuplicates',
      'freshProcessReplayDuplicates',
      'dashboardProjectionPassed',
      'externalActionsAttempted',
      'cleanupRan',
      'zeroResidue',
      'residueCount',
    ]) {
      expect(workflow).toContain(field);
    }
    expect(workflow).toContain('result.externalActionsAttempted === 0');
    expect(workflow).toContain('result.zeroResidue === true');
    expect(workflow).toContain('result.residueCount === 0');
    expect(workflow).toContain('GUEST_LIFECYCLE_PRODUCTION_ACCEPTANCE_OK');
  });
});
