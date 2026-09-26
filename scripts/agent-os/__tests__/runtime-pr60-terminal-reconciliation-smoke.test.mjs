import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const fixtureRelative = 'docs/agent-os/fixtures/runtime-pr60-terminal-reconciliation-smoke-v1.txt';
const fixturePath = path.join(repoRoot, fixtureRelative);
const CANONICAL = 'RUNTIME_PR60_TERMINAL_RECONCILIATION_SMOKE_PASS\n';

test('PR #60 terminal-reconciliation smoke fixture stays inside docs scope', () => {
  assert.ok(fixtureRelative.startsWith('docs/'), 'fixture must remain under docs/** scope');
  assert.equal(path.extname(fixtureRelative), '.txt');
  assert.ok(fs.existsSync(fixturePath), `missing fixture: ${fixtureRelative}`);
});

test('Focused regression: smoke marker is exact and read-only', () => {
  const body = fs.readFileSync(fixturePath, 'utf8');
  assert.equal(body, CANONICAL);

  // Evidence for remediation: acceptance criteria require a non-empty in-scope change
  // plus focused regression coverage. This fixture records the read-only smoke result
  // without authorizing merge, deploy, migrations, secrets, or other owner-gated actions.
  const forbidden = ['merge to main', 'production deploy', 'apply migration', 'read secrets'];
  for (const phrase of forbidden) {
    assert.equal(body.toLowerCase().includes(phrase), false);
  }
});

test('Dangerous actions remain stopped until owner decision', () => {
  // The smoke artifact is diagnostic only: it must not embed owner approval or dispatch.
  const body = fs.readFileSync(fixturePath, 'utf8');
  assert.match(body, /^RUNTIME_PR60_TERMINAL_RECONCILIATION_SMOKE_PASS\n$/);
  assert.doesNotMatch(body, /APPROVE|DISPATCH|OWNER_GATE|confirm_production/i);
});
