import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  decideBookingOpsSchedulerExecution, parseSchedulerAccountAllowlist,
  MANUAL_LIVE_CONFIRMATION,
} from './booking-ops-scheduler-policy.mjs';

const ACCOUNT_A = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_B = '22222222-2222-4222-8222-222222222222';
const schedule = (overrides = {}) => ({
  eventName: 'schedule', accountId: ACCOUNT_A, schedulerEnabled: 'true',
  scheduledLiveEnabled: '', scheduledAccountAllowlist: '', ...overrides,
});

test('schedule remains inactive unless owner sets exact enabled flag', () => {
  for (const flag of [undefined, '', 'True', '1', 'false']) {
    const decision = decideBookingOpsSchedulerExecution(schedule({ schedulerEnabled: flag }));
    assert.equal(decision.execute, false);
    assert.equal(decision.dryRun, true);
  }
});

test('schedule default is dry run even for accounts eligible at the server', () => {
  const decision = decideBookingOpsSchedulerExecution(schedule());
  assert.deepEqual(decision, { execute: true, dryRun: true, reason: 'scheduled_dry_run' });
});

test('live scheduler requires exact enablement and canonical account allowlist', () => {
  const flags = { scheduledLiveEnabled: 'true', scheduledAccountAllowlist: ACCOUNT_A };
  const live = decideBookingOpsSchedulerExecution(schedule(flags));
  assert.equal(live.execute, true);
  assert.equal(live.dryRun, false);
  assert.equal(live.reason, 'scheduled_live_account_allowlisted');
  const unrelated = decideBookingOpsSchedulerExecution(schedule({ ...flags, accountId: ACCOUNT_B }));
  assert.equal(unrelated.dryRun, true);
  assert.equal(unrelated.reason, 'account_not_live_allowlisted');
  assert.equal(decideBookingOpsSchedulerExecution(schedule({ ...flags, scheduledLiveEnabled: 'True' })).dryRun, true);
});

test('wildcards, invalid and duplicate allowlists fail closed', () => {
  for (const value of ['', '*', 'all', ACCOUNT_A + ',', ACCOUNT_A + ',' + ACCOUNT_A, 'bad-id']) {
    const allowed = parseSchedulerAccountAllowlist(value);
    assert.equal(allowed.valid, false);
    const decision = decideBookingOpsSchedulerExecution(schedule({
      scheduledLiveEnabled: 'true', scheduledAccountAllowlist: value,
    }));
    assert.equal(decision.execute, false);
    assert.equal(decision.dryRun, true);
  }
  assert.equal(parseSchedulerAccountAllowlist(ACCOUNT_A + ',' + ACCOUNT_B).valid, true);
});

test('manual invocation is dry-run by default and requires separate live confirmation', () => {
  const base = { eventName: 'workflow_dispatch', accountId: ACCOUNT_A };
  assert.equal(decideBookingOpsSchedulerExecution({ ...base, manualDryRun: 'true' }).dryRun, true);
  for (const bad of [undefined, '', 'not_authorized', 'wrong']) {
    const result = decideBookingOpsSchedulerExecution({
      ...base, manualDryRun: 'false', manualLiveConfirmation: bad,
    });
    assert.equal(result.execute, false);
    assert.equal(result.dryRun, true);
  }
  const live = decideBookingOpsSchedulerExecution({
    ...base, manualDryRun: 'false', manualLiveConfirmation: MANUAL_LIVE_CONFIRMATION,
  });
  assert.equal(live.execute, true);
  assert.equal(live.dryRun, false);
});

test('malformed manual flags and unauthorized events never execute', () => {
  assert.equal(decideBookingOpsSchedulerExecution({
    eventName: 'workflow_dispatch', accountId: ACCOUNT_A, manualDryRun: 'FALSE',
    manualLiveConfirmation: MANUAL_LIVE_CONFIRMATION,
  }).execute, false);
  assert.equal(decideBookingOpsSchedulerExecution({
    eventName: 'push', accountId: ACCOUNT_A, schedulerEnabled: 'true',
  }).execute, false);
  assert.equal(decideBookingOpsSchedulerExecution(schedule({ accountId: '*' })).execute, false);
});

test('scheduled workflow is independent of production deploy approval and gated when disabled', () => {
  const workflow = readFileSync(new URL('../.github/workflows/booking-ops-auto-send.yml', import.meta.url), 'utf8');
  assert.match(workflow, /environment: booking-ops-scheduler/);
  assert.doesNotMatch(workflow, /environment:\s*[Pp]roduction\b/);
  assert.match(workflow, /BOOKING_OPS_SCHEDULER_ENABLED/);
  assert.match(workflow, /ready=false/);
  assert.match(workflow, /needs\.preflight\.outputs\.ready == 'true'/);
  assert.match(workflow, /BOOKING_OPS_SCHEDULER_LIVE_ENABLED/);
  assert.match(workflow, /BOOKING_OPS_SCHEDULER_ACCOUNT_IDS/);
  assert.match(workflow, /MANUAL_LIVE_CONFIRMATION/);
  assert.match(workflow, /BOOKING_OPS_AUTO_SEND_RUNNER_SECRET/);
  assert.doesNotMatch(workflow, /VPS_SSH_KEY|SUPABASE_SERVICE_ROLE_KEY|CRON_SECRET/);
  assert.match(workflow, /scripts\/booking-ops-scheduler-policy\.mjs/);
  const deployment = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  assert.match(deployment, /environment: production/);
  assert.match(deployment, /confirm_live_guest_messaging/);
});

test('schedule account list is bounded and validated before any outbound request', () => {
  const workflow = readFileSync(new URL('../.github/workflows/booking-ops-auto-send.yml', import.meta.url), 'utf8');
  assert.match(workflow, /ids\.length > 20/);
  assert.match(workflow, /new Set\(ids\.map/);
  assert.match(workflow, /Invalid or oversized account discovery response/);
  assert.match(workflow, /max_batch_size must be between 1 and 20/);
});
