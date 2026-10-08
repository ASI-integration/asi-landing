import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStatusPatch,
  hasExactProductionApproval,
  isRetryableStatusWriteError,
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

test('isRetryableStatusWriteError recognizes transient Windows file-lock errors', () => {
  assert.equal(isRetryableStatusWriteError({ code: 'EPERM' }), true);
  assert.equal(isRetryableStatusWriteError({ code: 'EBUSY' }), true);
  assert.equal(isRetryableStatusWriteError({ code: 'EACCES' }), true);
  assert.equal(isRetryableStatusWriteError({ code: 'ENOENT' }), false);
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

test('production authorization requires exact SHA, independent live-outbound acknowledgement and opt-in', () => {
  const sha = 'c'.repeat(40);
  const authorized = {
    'allow-production': true,
    'approved-sha': sha,
    'confirm-live-guest-messaging': 'ENABLE_LIVE_GUEST_MESSAGING',
  };
  assert.equal(hasExactProductionApproval({}, sha), false);
  assert.equal(hasExactProductionApproval({ 'allow-production': true }, sha), false);
  assert.equal(hasExactProductionApproval({ ...authorized, 'approved-sha': 'd'.repeat(40) }, sha), false);
  assert.equal(hasExactProductionApproval({ ...authorized, 'approved-sha': undefined }, sha), false);
  assert.equal(hasExactProductionApproval({ ...authorized, 'confirm-live-guest-messaging': 'not_authorized' }, sha), false);
  assert.equal(hasExactProductionApproval({ ...authorized, 'allow-production': 'true' }, sha), false);
  assert.equal(hasExactProductionApproval(authorized, 'not-a-sha'), false);
  assert.equal(hasExactProductionApproval(authorized, sha), true);
  // Approval is intentionally bound to a single commit, not a moving branch.
  assert.equal(hasExactProductionApproval(authorized, 'e'.repeat(40)), false);
});

test('continuation runner does not silently approve GitHub production environments', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('./production-continuation-runner.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /pending_deployments|approvePendingDeployments/);
  assert.match(source, /phase: 'awaiting_production_approval'/);
  assert.match(source, /phase: 'awaiting_exact_production_approval'/);
  assert.match(source, /confirm_live_guest_messaging: 'ENABLE_LIVE_GUEST_MESSAGING'/);
  assert.match(source, /Workflow run SHA mismatch/);
});

test('parseArgs accepts documented exact-SHA equals syntax', () => {
  const sha = '1'.repeat(40);
  const args = parseArgs([
    '--allow-production',
    `--approved-sha=${sha}`,
    '--confirm-live-guest-messaging=ENABLE_LIVE_GUEST_MESSAGING',
  ]);
  assert.equal(args['approved-sha'], sha);
  assert.equal(args['allow-production'], true);
  assert.equal(hasExactProductionApproval(args, sha), true);
  assert.equal(hasExactProductionApproval(args, '2'.repeat(40)), false);
});
