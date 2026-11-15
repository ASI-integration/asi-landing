// Uses Node's offline runner because this exact allowlisted path is outside the
// repository Vitest include glob. Run: node --import tsx --test <this file>.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assessStrigunovReadiness, STRIGUNOV_CRITERIA } from './strigunov-readiness';
import type { ReadinessEvidence, ReadinessIdentity, StrigunovGate } from './strigunov-readiness';

const identity: ReadinessIdentity = {
  environment: 'staging',
  sourceSha: 'a'.repeat(40), target: 'isolated-staging', runId: 'run-1',
  accountId: 'synthetic-account', propertyId: 'synthetic-property', intervalId: 'interval-1',
};
function receipts(): ReadinessEvidence[] {
  return (Object.keys(STRIGUNOV_CRITERIA) as StrigunovGate[]).flatMap(gate =>
    STRIGUNOV_CRITERIA[gate].flatMap(criterion =>
      (['source', 'ci', 'staging'] as const).map(kind => ({
        gate, criterion, kind, status: 'PASS' as const,
        reference: `fixture:${gate}:${criterion}:${kind}`, sourceSha: identity.sourceSha, identity,
      }))));
}

test('empty input reports every gate as unknown with missing evidence labels', () => {
  const result = assessStrigunovReadiness();
  assert.equal(result.status, 'NOT_READY');
  assert.deepEqual(result.stages.map(stage => stage.gate), ['G2', 'G3', 'G4', 'G5', 'G6']);
  for (const stage of result.stages) {
    assert.equal(stage.status, 'UNKNOWN');
    for (const item of stage.criteria) {
      assert.deepEqual(item.missingEvidence, ['MISSING_OR_INVALID_STAGING_IDENTITY',
        'MISSING_SOURCE_EVIDENCE', 'MISSING_STAGING_ACCEPTANCE_EVIDENCE']);
    }
  }
});

test('source and CI alone never establish physical acceptance', () => {
  for (const kinds of [['source'], ['ci'], ['source', 'ci']]) {
    const result = assessStrigunovReadiness({ identity, evidence: receipts().filter(item => kinds.includes(item.kind)) });
    assert.equal(result.status, 'NOT_READY');
    assert.ok(result.stages.every(stage => stage.criteria.every(item => item.stagingStatus === 'UNKNOWN')));
  }
});

test('complete supplied pilot receipts can be assessed without granting authority', () => {
  const result = assessStrigunovReadiness({ identity, evidence: receipts() });
  assert.equal(result.status, 'READY_FOR_DEMO');
  assert.equal(result.scope, 'BOUNDED_SYNTHETIC_STAGING_PILOT');
  assert.equal(result.authorized, false);
});

test('every individual source or staging criterion is mandatory, including owner acceptance', () => {
  const evidence = receipts();
  for (const missing of evidence.filter(item => item.kind !== 'ci')) {
    assert.equal(assessStrigunovReadiness({ identity, evidence: evidence.filter(item => item !== missing) }).status, 'NOT_READY');
  }
});

test('unknown, failed, blank and conflicting evidence cannot pass', () => {
  for (const patch of [{ status: 'UNKNOWN' as const }, { status: 'FAIL' as const }, { reference: ' ' }]) {
    const evidence = receipts();
    evidence[0] = { ...evidence[0], ...patch };
    assert.equal(assessStrigunovReadiness({ identity, evidence }).status, 'NOT_READY');
  }
  for (const status of ['UNKNOWN', 'FAIL'] as const) {
    const evidence = receipts();
    evidence.push({ ...evidence[0], status });
    assert.equal(assessStrigunovReadiness({ identity, evidence }).status, 'NOT_READY');
  }
});

test('staging receipts must match every identity dimension and source SHA', () => {
  for (const key of Object.keys(identity) as (keyof ReadinessIdentity)[]) {
    const evidence = receipts().map(item => item.kind === 'staging'
      ? { ...item, identity: { ...identity, [key]: 'different' } } : item);
    assert.equal(assessStrigunovReadiness({ identity, evidence }).status, 'NOT_READY');
    assert.equal(assessStrigunovReadiness({ identity: { ...identity, [key]: '' }, evidence: receipts() }).status, 'NOT_READY');
  }
  assert.equal(assessStrigunovReadiness({ identity, evidence: receipts().map(item => ({ ...item, sourceSha: 'b'.repeat(40) })) }).status, 'NOT_READY');
});

test('assessment is deterministic and does not mutate frozen input', () => {
  const evidence = receipts().map(item => Object.freeze(item));
  Object.freeze(identity);
  Object.freeze(evidence);
  const input = Object.freeze({ identity, evidence });
  const before = JSON.stringify(input);
  assert.deepEqual(assessStrigunovReadiness(input), assessStrigunovReadiness(input));
  assert.equal(JSON.stringify(input), before);
});

test('product module has no imports or external execution and write capabilities', () => {
  const source = readFileSync('src/lib/observability/strigunov-readiness.ts', 'utf8');
  assert.doesNotMatch(source, /^\s*import\s/m);
  assert.doesNotMatch(source, /\b(require|fetch|XMLHttpRequest|WebSocket|eval|Function|setTimeout|setInterval)\s*\(/);
  assert.doesNotMatch(source, /\b(process|globalThis|window|document|navigator|console)\s*[.\[]/);
  assert.doesNotMatch(source, /\b(writeFile|appendFile|exec|spawn|send|insert|update|delete)\s*\(/);
});
