import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const scheduledAccounts = vi.hoisted(() =>
  vi.fn(async () => ['11111111-1111-4111-8111-111111111111']),
);
const executeBatch = vi.hoisted(() => vi.fn(async (input: Record<string, unknown>) => ({
  ok: true,
  processed: 0,
  sent: 0,
  dryRun: input.dryRun === true ? 1 : 0,
  failed: 0,
  blocked: 0,
  safeSummary: 'ok',
})));

vi.mock('@/lib/booking-ops/communication-auto-send-scopes', () => ({
  listScheduledAutoSendAccountIds: scheduledAccounts,
}));

vi.mock('@/lib/booking-ops/communication-auto-send-executor', () => ({
  executeEligibleAutoSendBatch: executeBatch,
}));

describe('Booking Ops account-scoped auto-send scheduler', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    scheduledAccounts.mockClear();
    executeBatch.mockClear();
    vi.stubEnv('BOOKING_OPS_AUTO_SEND_RUNNER_SECRET', 'scheduler-test-secret');
  });

  it('protects account discovery with the internal runner secret', async () => {
    const route = await import('@/app/api/internal/booking-ops/communications/auto-send/accounts/route');
    const unauthorized = await route.GET(new Request('https://asi.test/api/internal/booking-ops/communications/auto-send/accounts'));
    expect(unauthorized.status).toBe(401);

    const authorized = await route.GET(new Request(
      'https://asi.test/api/internal/booking-ops/communications/auto-send/accounts',
      { headers: { Authorization: 'Bearer scheduler-test-secret' } },
    ));
    expect(authorized.status).toBe(200);
    await expect(authorized.json()).resolves.toEqual({
      ok: true,
      accountIds: ['11111111-1111-4111-8111-111111111111'],
      count: 1,
    });
  });


  it('fails closed to dry-run unless live execution is explicitly requested', async () => {
    const route = await import('@/app/api/internal/booking-ops/communications/auto-send/run/route');
    const base = {
      headers: {
        Authorization: 'Bearer scheduler-test-secret',
        'Content-Type': 'application/json',
      },
      method: 'POST',
    };

    const missingFlag = await route.POST(new Request(
      'https://asi.test/api/internal/booking-ops/communications/auto-send/run',
      { ...base, body: JSON.stringify({ accountId: '11111111-1111-4111-8111-111111111111' }) },
    ));
    expect(missingFlag.status).toBe(200);
    expect(executeBatch).toHaveBeenLastCalledWith(expect.objectContaining({ dryRun: true }));

    const explicitLive = await route.POST(new Request(
      'https://asi.test/api/internal/booking-ops/communications/auto-send/run',
      { ...base, body: JSON.stringify({
        accountId: '11111111-1111-4111-8111-111111111111',
        dryRun: false,
      }) },
    ));
    expect(explicitLive.status).toBe(200);
    expect(executeBatch).toHaveBeenLastCalledWith(expect.objectContaining({ dryRun: false }));
  });

  it('runs every ten minutes and dispatches one explicit account at a time', () => {
    const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/booking-ops-auto-send.yml'), 'utf8');
    expect(workflow).toContain("cron: '*/10 * * * *'");
    expect(workflow).toContain('environment: production');
    expect(workflow).toContain('/auto-send/accounts');
    expect(workflow).toContain('accountId:process.argv[1]');
    expect(workflow).toContain('for account_id in');
    expect(workflow).toContain('run_account "$account_id" "false" "10" "scheduled"');
    expect(workflow).toContain('run_account "${MANUAL_ACCOUNT_ID:-}" "${MANUAL_DRY_RUN:-true}" "${MANUAL_MAX_BATCH_SIZE:-10}" "manual"');
  });
});
