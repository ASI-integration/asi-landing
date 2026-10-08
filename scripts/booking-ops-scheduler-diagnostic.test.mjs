import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySchedulerRuns, inspectScheduler } from './booking-ops-scheduler-diagnostic.mjs';

const shaOld = 'a'.repeat(40);
const shaNew = 'b'.repeat(40);
const run = (overrides = {}) => ({
  databaseId: 123, event: 'schedule', status: 'waiting', conclusion: '',
  headSha: shaOld, createdAt: '2026-10-08T03:25:19Z',
  url: 'https://github.com/ASI-integration/asi-landing/actions/runs/123',
  ...overrides,
});

test('protected scheduled run is explicitly marked awaiting environment approval', () => {
  const result = classifySchedulerRuns({
    runs: [run()],
    pendingByRun: { 123: [{ environment: { name: 'Production' } }] },
    mainSha: shaNew, productionSha: shaOld, productionHealthy: true,
    now: Date.parse('2026-10-08T03:45:19Z'),
  });
  assert.equal(result.state, 'awaiting_environment_approval');
  assert.equal(result.latest.protectedEnvironmentApproval, true);
  assert.equal(result.latest.ageMinutes, 20);
  assert.equal(result.versionMismatch, true);
  assert.equal(result.deliveryConfirmed, false);
  assert.match(result.action, /do not auto-approve/);
});

test('waiting without readable approval evidence remains unverified', () => {
  const result = classifySchedulerRuns({ runs: [run()], pendingByRun: { 123: null } });
  assert.equal(result.state, 'waiting_unverified');
  assert.equal(result.latest.protectedEnvironmentApproval, false);
  assert.equal(result.deliveryConfirmed, false);
});

test('latest scheduled run takes precedence over older successful and manual runs', () => {
  const result = classifySchedulerRuns({
    runs: [
      run({ databaseId: 122, status: 'completed', conclusion: 'success',
        createdAt: '2026-10-07T19:00:00Z' }),
      run({ databaseId: 124, event: 'workflow_dispatch', status: 'completed', conclusion: 'success',
        createdAt: '2026-10-08T05:00:00Z' }),
      run({ databaseId: 123, status: 'completed', conclusion: 'cancelled' }),
    ],
  });
  assert.equal(result.state, 'cancelled');
  assert.equal(result.latest.id, 123);
  assert.equal(result.scheduledRunsChecked, 2);
  assert.equal(result.cancelledRuns, 1);
});

test('workflow success is not treated as proof of an external message', () => {
  const result = classifySchedulerRuns({
    runs: [run({ status: 'completed', conclusion: 'success' })],
  });
  assert.equal(result.state, 'workflow_success_delivery_unverified');
  assert.equal(result.deliveryConfirmed, false);
});

test('unknown production state never implies healthy or matching', () => {
  const result = classifySchedulerRuns({ runs: [] });
  assert.equal(result.state, 'no_scheduled_runs');
  assert.equal(result.productionHealthy, null);
  assert.equal(result.versionMismatch, false);
  assert.equal(result.mainSha, null);
});

test('read-only diagnostics request only status, approval metadata and public health', async () => {
  const queries = [];
  const urls = [];
  const gh = (args) => {
    queries.push(args.join(' '));
    if (args[0] === 'run') return [run()];
    if (args[1]?.endsWith('pending_deployments')) return [{ environment: { name: 'Production' } }];
    if (args[1] === 'repos/ASI-integration/asi-landing/commits/main') return { sha: shaNew };
    throw new Error('Unexpected GitHub query');
  };
  const getPublic = async (url) => {
    urls.push(url);
    return url.endsWith('/health') ? { ok: true } : { sha: shaOld };
  };
  const result = await inspectScheduler({ gh, getPublic });
  assert.equal(result.state, 'awaiting_environment_approval');
  assert.equal(result.versionMismatch, true);
  assert.equal(queries.length, 3);
  assert.ok(queries.every((q) => q.startsWith('run list ') || q.startsWith('api repos/')));
  assert.ok(queries.every((q) => !/dispatch|--method|POST|PUT|DELETE/.test(q)));
  assert.deepEqual(urls.sort(), [
    'https://asi-global.ru/api/health', 'https://asi-global.ru/api/version',
  ]);
});

test('GitHub approval query failure stays unverified, with no optimistic fallback', async () => {
  const gh = (args) => {
    if (args[0] === 'run') return [run()];
    if (args[1]?.endsWith('pending_deployments')) throw new Error('Network timeout');
    if (args[1]?.endsWith('/commits/main')) return { sha: shaNew };
    throw new Error('Unexpected');
  };
  const result = await inspectScheduler({ gh, getPublic: async () => ({}) });
  assert.equal(result.state, 'waiting_unverified');
  assert.equal(result.deliveryConfirmed, false);
});

test('GitHub listing failure is visible instead of a misleading empty summary', async () => {
  await assert.rejects(
    inspectScheduler({ gh: () => { throw new Error('No GitHub access'); } }),
    /No GitHub access/,
  );
});

test('rejects invalid repo selectors before using an external CLI', async () => {
  await assert.rejects(inspectScheduler({ repo: 'test;bad' }), /Invalid repo selector/);
});
