import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WORKFLOW = resolve(process.cwd(), '.github/workflows/pr-validation.yml');
const TASK_SERVICE = resolve(process.cwd(), 'src/lib/pilot/task-service.ts');

const STRIGUNOV_STEP = 'Strigunov pilot readiness and Bridge admission regression';
const PRUNE_STEP = 'Prune devDependencies for runtime bundle';
const BUILD_STEP = 'Build';
const ARTIFACT_SMOKE = 'Artifact smoke (isolated local port)';

function validateJobSource(workflow: string): string {
  const start = workflow.indexOf('\n  validate:');
  const nextJob = workflow.indexOf('\n  channel-manager-recovery-postgres:');
  expect(start).toBeGreaterThan(-1);
  expect(nextJob).toBeGreaterThan(start);
  return workflow.slice(start, nextJob);
}

function stepNames(jobSource: string): string[] {
  return [...jobSource.matchAll(/^\s+- name: (.+)$/gm)].map((match) => match[1]!.trim());
}

describe('PR Validation workflow ordering lock', () => {
  it('runs Strigunov Pilot Vitest before pruning devDependencies', () => {
    const workflow = readFileSync(WORKFLOW, 'utf8');
    const validate = validateJobSource(workflow);
    const names = stepNames(validate);

    expect(names).toContain(STRIGUNOV_STEP);
    expect(names).toContain(PRUNE_STEP);
    expect(names).toContain(BUILD_STEP);
    expect(names).toContain(ARTIFACT_SMOKE);

    expect(names.indexOf(STRIGUNOV_STEP)).toBeLessThan(names.indexOf(PRUNE_STEP));
    expect(names.indexOf(BUILD_STEP)).toBeLessThan(names.indexOf(PRUNE_STEP));
    expect(names.indexOf(PRUNE_STEP)).toBeLessThan(names.indexOf(ARTIFACT_SMOKE));

    const strigunovOffset = validate.indexOf(`- name: ${STRIGUNOV_STEP}`);
    const pruneOffset = validate.indexOf(`- name: ${PRUNE_STEP}`);
    const nextStepAfterStrigunov = validate.indexOf('\n      - name:', strigunovOffset + 10);
    expect(strigunovOffset).toBeGreaterThan(-1);
    expect(pruneOffset).toBeGreaterThan(strigunovOffset);
    const strigunovBody = validate.slice(
      strigunovOffset,
      nextStepAfterStrigunov === -1 ? pruneOffset : nextStepAfterStrigunov,
    );

    expect(strigunovBody).toContain('npx vitest run');
    expect(strigunovBody).toContain('src/lib/pilot/__tests__/idempotency.test.ts');
    expect(strigunovBody).toContain('src/lib/pilot/__tests__/pr-validation-workflow.test.ts');
    expect(strigunovBody).toContain('src/lib/asi-runtime/__tests__/bridge-single-lane-preflight.test.ts');
    expect(strigunovBody).not.toMatch(/npm (ci|install)/);
    expect(validate.slice(pruneOffset)).not.toMatch(
      /npx vitest run[\s\S]*src\/lib\/pilot\/__tests__/,
    );
  });

  it('keeps artifact, channel-manager, and PostgreSQL jobs intact', () => {
    const workflow = readFileSync(WORKFLOW, 'utf8');
    expect(workflow).toContain('Create release artifact (.tgz)');
    expect(workflow).toContain(ARTIFACT_SMOKE);
    expect(workflow).toContain('channel-manager-recovery-postgres:');
    expect(workflow).toContain('Bridge single-lane admission PostgreSQL contract');
    expect(workflow).toContain('BRIDGE_SINGLE_LANE_PREFLIGHT_PG_PROOF');
    expect(workflow).toContain('id: strigunov_pilot_regression');
  });

  it('locks submitPilotTask lookup before new-create rate-limit and readiness', () => {
    const source = readFileSync(TASK_SERVICE, 'utf8');
    const fnStart = source.indexOf('export async function submitPilotTask');
    const fnEnd = source.indexOf('export async function submitPilotOwnerDecision');
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const body = source.slice(fnStart, fnEnd);

    const privileged = body.indexOf('assertNoPrivilegedPilotFields');
    const template = body.indexOf('buildPilotGreenTemplate');
    const key = body.indexOf('normalizeClientIdempotencyKey');
    const lookup = body.indexOf('findRuntimeBridgeTaskByIdempotencyKey');
    const rate = body.indexOf('assertPilotCreateRateLimit');
    const ready = body.indexOf('assertPilotSubmissionReady');
    const submit = body.indexOf('submitRuntimeBridgeTask');

    expect(privileged).toBeGreaterThan(-1);
    expect(template).toBeGreaterThan(privileged);
    expect(key).toBeGreaterThan(template);
    expect(lookup).toBeGreaterThan(key);
    expect(rate).toBeGreaterThan(lookup);
    expect(ready).toBeGreaterThan(rate);
    expect(submit).toBeGreaterThan(ready);
  });
});
