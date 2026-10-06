import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStatusPatch,
  isTransientGhFailure,
  latestCheckRollupGreen,
  parseArgs,
} from './production-continuation-runner.mjs';

test('parseArgs supports flags and values', () => {
  assert.deepEqual(
    parseArgs([
      '--task', 'telegram-text',
      '--repo', 'ASI-integration/asi-landing',
      '--watch-main',
      '--allow-production',
      '--max-hours', '8',
    ]),
    {
      task: 'telegram-text',
      repo: 'ASI-integration/asi-landing',
      'watch-main': true,
      'allow-production': true,
      'max-hours': '8',
    },
  );
});

test('latestCheckRollupGreen uses the newest run for duplicate check names', () => {
  const checks = [
    {
      name: 'validate',
      status: 'COMPLETED',
      conclusion: 'CANCELLED',
      startedAt: '2026-10-06T15:00:00Z',
    },
    {
      name: 'validate',
      status: 'COMPLETED',
      conclusion: 'SUCCESS',
      startedAt: '2026-10-06T15:05:00Z',
    },
    {
      name: 'communication-regression',
      status: 'COMPLETED',
      conclusion: 'SUCCESS',
      startedAt: '2026-10-06T15:04:00Z',
    },
  ];
  assert.equal(latestCheckRollupGreen(checks), true);
});

test('latestCheckRollupGreen is false for pending or failed latest checks', () => {
  assert.equal(
    latestCheckRollupGreen([
      {
        name: 'validate',
        status: 'IN_PROGRESS',
        conclusion: '',
        startedAt: '2026-10-06T15:05:00Z',
      },
    ]),
    false,
  );
  assert.equal(
    latestCheckRollupGreen([
      {
        name: 'validate',
        status: 'COMPLETED',
        conclusion: 'FAILURE',
        startedAt: '2026-10-06T15:05:00Z',
      },
    ]),
    false,
  );
});

test('isTransientGhFailure recognizes retryable GitHub/network failures', () => {
  assert.equal(isTransientGhFailure('net/http: TLS handshake timeout'), true);
  assert.equal(isTransientGhFailure('Could not resolve host: api.github.com'), true);
  assert.equal(isTransientGhFailure('HTTP 503 Service Unavailable'), true);
  assert.equal(isTransientGhFailure('validation failed: bad workflow input'), false);
});

test('buildStatusPatch keeps prior fields and refreshes updatedAt', () => {
  const before = {
    task: 'telegram-text',
    phase: 'starting',
    custom: 7,
    updatedAt: 'old',
  };
  const after = buildStatusPatch(before, { phase: 'acceptance_wait' });
  assert.equal(after.task, 'telegram-text');
  assert.equal(after.custom, 7);
  assert.equal(after.phase, 'acceptance_wait');
  assert.notEqual(after.updatedAt, 'old');
  assert.ok(Number.isFinite(Date.parse(after.updatedAt)));
});
