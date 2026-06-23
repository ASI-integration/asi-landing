import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findAcceptanceEscalationReview: vi.fn(),
  verifyTelegramOpsTaskForReview: vi.fn(),
  runTelegramOpsAcceptanceLifecycle: vi.fn(),
  runTelegramOpsAcceptanceFull: vi.fn(),
  cleanupTelegramOpsAcceptanceData: vi.fn(),
}));

vi.mock('@/lib/communication/telegram-ops-acceptance', () => ({
  buildTelegramOpsAcceptanceMessage: (runId: string) => `ASI_TG_OPS_ACCEPTANCE_${runId} msg`,
  findAcceptanceEscalationReview: mocks.findAcceptanceEscalationReview,
  verifyTelegramOpsTaskForReview: mocks.verifyTelegramOpsTaskForReview,
  runTelegramOpsAcceptanceLifecycle: mocks.runTelegramOpsAcceptanceLifecycle,
  runTelegramOpsAcceptanceFull: mocks.runTelegramOpsAcceptanceFull,
  cleanupTelegramOpsAcceptanceData: mocks.cleanupTelegramOpsAcceptanceData,
}));

import { POST } from '@/app/api/internal/telegram-ops-acceptance/route';

describe('POST /api/internal/telegram-ops-acceptance', () => {
  beforeEach(() => {
    vi.stubEnv('INTERNAL_TEST_SECRET', 'test-secret');
    vi.clearAllMocks();
  });

  it('rejects unauthorized requests', async () => {
    const req = new Request('https://example.test/api/internal/telegram-ops-acceptance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'poll_review', chatId: '1', marker: 'ASI_TG_OPS_ACCEPTANCE_x' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it('runs automated acceptance without getUpdates', async () => {
    mocks.runTelegramOpsAcceptanceFull.mockResolvedValue({
      ok: true,
      failures: [],
      runId: 'run1',
      marker: 'ASI_TG_OPS_ACCEPTANCE_run1',
      chatId: '990001337',
      reviewId: 'rev-1',
      taskId: 'task-1',
      processOutcome: 'replied',
      firstSync: { created: 1, scanned: 2 },
      secondSync: { created: 0, scanned: 2 },
    });

    const req = new Request('https://example.test/api/internal/telegram-ops-acceptance', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-test-secret': 'test-secret',
      },
      body: JSON.stringify({ action: 'run' }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mocks.runTelegramOpsAcceptanceFull).toHaveBeenCalledOnce();
  });

  it('polls pending escalation review by chat id and marker', async () => {
    mocks.findAcceptanceEscalationReview.mockReturnValue({
      reviewId: 'rev-1',
      sessionId: 'sess-1',
      status: 'pending',
      escalationReason: 'operator_required',
      createdAt: '2026-06-23T10:00:00.000Z',
    });

    const req = new Request('https://example.test/api/internal/telegram-ops-acceptance', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-test-secret': 'test-secret',
      },
      body: JSON.stringify({
        action: 'poll_review',
        chatId: '99323236',
        marker: 'ASI_TG_OPS_ACCEPTANCE_run1',
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.found).toBe(true);
    expect(body.review.reviewId).toBe('rev-1');
  });

  it('verifies OPS sync chain for review id', async () => {
    mocks.verifyTelegramOpsTaskForReview.mockResolvedValue({
      ok: true,
      failures: [],
      taskId: 'task-1',
      firstSync: { created: 1, scanned: 2 },
      secondSync: { created: 0, scanned: 2 },
    });

    const req = new Request('https://example.test/api/internal/telegram-ops-acceptance', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-test-secret': 'test-secret',
      },
      body: JSON.stringify({
        action: 'verify_ops',
        reviewId: 'rev-1',
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.taskId).toBe('task-1');
  });
});
