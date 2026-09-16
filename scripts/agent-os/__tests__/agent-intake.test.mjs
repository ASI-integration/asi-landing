import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  REQUIRED_ISSUE_FIELD_IDS,
  REQUIRED_PR_SECTIONS,
  assertIssueTemplateContract,
  assertIssueTemplateDefaultFlow,
  assertPullRequestTemplateContract,
  checkRepositoryIntakeContracts,
  validateIssueBody,
  validatePullRequestBody,
  validateTaskInput,
} from '../check-agent-intake.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const checkScript = path.join(repoRoot, 'scripts/agent-os/check-agent-intake.mjs');
const fixtures = path.join(repoRoot, 'docs/agent-os/fixtures');

test('repository templates form the default agent-ready intake flow', () => {
  const result = checkRepositoryIntakeContracts(repoRoot);
  assert.equal(result.ok, true);
  assert.equal(result.issueConfig.blankIssuesEnabled, false);
  for (const id of REQUIRED_ISSUE_FIELD_IDS) {
    assert.ok(result.issueTemplate.fieldIds.includes(id), id);
  }
  for (const section of REQUIRED_PR_SECTIONS) {
    assert.ok(result.pullRequestTemplate.sections.includes(section), section);
  }
});

test('complete docs-only task input is READY', () => {
  const input = JSON.parse(fs.readFileSync(path.join(fixtures, 'docs-only-task-input.json'), 'utf8'));
  const result = validateTaskInput(input);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'READY');
  assert.deepEqual(result.blockers, []);
});

test('incomplete task input is fail-closed BLOCKED', () => {
  const input = JSON.parse(fs.readFileSync(path.join(fixtures, 'incomplete-task-input.json'), 'utf8'));
  const result = validateTaskInput(input);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.blockers.some((entry) => entry.includes('task.objective')));
  assert.ok(result.blockers.some((entry) => entry.includes('task.acceptanceCriteria')));
});

test('red task without redActions is BLOCKED', () => {
  const result = validateTaskInput({
    task: {
      id: 'red-missing-actions',
      title: 'Red without actions',
      objective: 'Prove fail-closed red intake.',
      acceptanceCriteria: ['Blocked without redActions'],
      inScope: ['docs/agent-os/'],
      outOfScope: ['Production'],
    },
    classification: 'red',
    redActions: [],
  });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.some((entry) => /redActions/i.test(entry)));
});

test('complete agent-ready issue body is READY', () => {
  const body = fs.readFileSync(path.join(fixtures, 'agent-ready-issue-body.md'), 'utf8');
  const result = validateIssueBody(body);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'READY');
});

test('incomplete issue body is fail-closed BLOCKED', () => {
  const body = fs.readFileSync(path.join(fixtures, 'incomplete-issue-body.md'), 'utf8');
  const result = validateIssueBody(body);
  assert.equal(result.ok, false);
  assert.equal(result.status, 'BLOCKED');
  assert.ok(result.blockers.length > 0);
});

test('complete PR DoD body is READY and incomplete body is BLOCKED', () => {
  const ready = validatePullRequestBody(
    fs.readFileSync(path.join(fixtures, 'agent-ready-pr-body.md'), 'utf8'),
  );
  assert.equal(ready.ok, true);

  const incomplete = validatePullRequestBody('## Результат\n\nSomething changed.\n');
  assert.equal(incomplete.ok, false);
  assert.ok(incomplete.blockers.some((entry) => entry.includes('Scope')));
});

test('CLI rejects incomplete task input and accepts repository contracts', () => {
  const bad = spawnSync(
    process.execPath,
    [checkScript, '--task-input', path.join(fixtures, 'incomplete-task-input.json')],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /BLOCKED|"ok":false/);

  const good = spawnSync(process.execPath, [checkScript, '--repo'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(good.status, 0, good.stderr || good.stdout);
  const payload = JSON.parse(good.stdout.trim());
  assert.equal(payload.ok, true);
});

test('disabling blank issues is required for default flow', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'asi-intake-'));
  fs.mkdirSync(path.join(tempRoot, '.github/ISSUE_TEMPLATE'), { recursive: true });
  fs.writeFileSync(
    path.join(tempRoot, '.github/ISSUE_TEMPLATE/config.yml'),
    'blank_issues_enabled: true\n',
  );
  assert.throws(
    () => assertIssueTemplateDefaultFlow(tempRoot),
    /blank_issues_enabled must be false/,
  );
  assert.doesNotThrow(() => assertIssueTemplateContract(repoRoot));
  assert.doesNotThrow(() => assertPullRequestTemplateContract(repoRoot));
});
