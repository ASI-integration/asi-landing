import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const scheduledAccounts = vi.hoisted(() =>
  vi.fn(async () => ['11111111-1111-4111-8111-111111111111']),
);

vi.mock('@/lib/booking-ops/communication-auto-send-scopes', () => ({
  listScheduledAutoSendAccountIds: scheduledAccounts,
}));

describe('Booking Ops account-scoped auto-send scheduler', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    scheduledAccounts.mockClear();
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
