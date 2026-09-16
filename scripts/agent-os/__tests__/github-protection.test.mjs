import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { readJson } from '../contracts.mjs';
import {
  checkGithubProtection,
  evaluateProtectionSnapshot,
  loadDesiredProtection,
} from '../check-github-protection.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('desired github protection contract validates', () => {
  const desired = loadDesiredProtection(repoRoot);
  assert.equal(desired.schemaVersion, 'asi.agent-os.github-protection-desired.v1');
  assert.deepEqual(desired.mainProtection.requiredStatusChecks, ['validate']);
  assert.equal(desired.closure.ao001, 'open');
  assert.equal(desired.closure.ao002, 'open');
});

test('offline mode fail-closes on gap fixture and passes ready fixture', () => {
  const result = checkGithubProtection({ repoRoot, mode: 'offline' });
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'offline');
  assert.ok(result.gapGaps > 0);
  assert.equal(result.readyOk, true);
});

test('gap fixture reports AO-001 and staging AO-002 gaps', () => {
  const desired = loadDesiredProtection(repoRoot);
  const gap = readJson(path.join(repoRoot, 'docs/agent-os/fixtures/github-protection-live-gap-fixture.json'));
  const evaluation = evaluateProtectionSnapshot(gap, desired);
  assert.equal(evaluation.ok, false);
  assert.ok(evaluation.gaps.some((gapText) => gapText.startsWith('AO-001:')));
  assert.ok(evaluation.gaps.some((gapText) => gapText.includes('staging')));
});

test('ready fixture has zero gaps', () => {
  const desired = loadDesiredProtection(repoRoot);
  const ready = readJson(path.join(repoRoot, 'docs/agent-os/fixtures/github-protection-live-ready-fixture.json'));
  const evaluation = evaluateProtectionSnapshot(ready, desired);
  assert.equal(evaluation.ok, true);
  assert.deepEqual(evaluation.gaps, []);
});

test('CODEOWNERS and runbook exist as repo prerequisites', () => {
  assert.ok(fs.existsSync(path.join(repoRoot, '.github/CODEOWNERS')));
  assert.ok(fs.existsSync(path.join(repoRoot, 'docs/agent-os/GITHUB_PROTECTION.md')));
  const codeowners = fs.readFileSync(path.join(repoRoot, '.github/CODEOWNERS'), 'utf8');
  assert.match(codeowners, /@ASI-integration/);
});
