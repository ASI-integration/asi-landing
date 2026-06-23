/**
 * Unit tests for Telegram → Communication → OPS live acceptance helpers.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listEscalationReviews: vi.fn(),
  syncAutoOpsTasks: vi.fn(),
  listOpsOperatorTasks: vi.fn(),
  listOpsV1Tasks: vi.fn(),
  updateOpsV1Task: vi.fn(),
  closeEscalationReview: vi.fn(),
  supabaseDelete: vi.fn(),
}));

vi.mock('@/lib/communication/operator-review', () => ({
  listEscalationReviews: mocks.listEscalationReviews,
  closeEscalationReview: mocks.closeEscalationReview,
}));

vi.mock('@/lib/ops-v1/auto-tasks', () => ({
  syncAutoOpsTasks: mocks.syncAutoOpsTasks,
}));

vi.mock('@/lib/ops-board/repository', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ops-board/repository')>();
  return {
    ...actual,
    listOpsOperatorTasks: mocks.listOpsOperatorTasks,
  };
});

vi.mock('@/lib/ops-v1/repository', () => ({
  listOpsV1Tasks: mocks.listOpsV1Tasks,
  updateOpsV1Task: mocks.updateOpsV1Task,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      delete: () => ({
        eq: mocks.supabaseDelete,
      }),
    }),
  },
}));

import {
  buildTelegramOpsAcceptanceMessage,
  findAcceptanceEscalationReview,
  runTelegramOpsAcceptanceLifecycle,
  verifyTelegramOpsTaskForReview,
} from '@/lib/communication/telegram-ops-acceptance';
import { buildAutoOpsDedupKey } from '@/lib/ops-board/repository';

describe('telegram ops acceptance helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.syncAutoOpsTasks.mockResolvedValue({ created: 1, scanned: 3 });
    mocks.supabaseDelete.mockResolvedValue({ error: null });
  });

  it('builds a unique acceptance telegram message', () => {
    const message = buildTelegramOpsAcceptanceMessage('abc123');
    expect(message).toContain('ASI_TG_OPS_ACCEPTANCE_abc123');
    expect(message).toContain('У гостя проблема, срочно нужен оператор');
  });

  it('finds pending review by chat id and marker', () => {
    mocks.listEscalationReviews.mockReturnValue([
      {
        reviewId: 'rev-1',
        targetId: '99323236',
        status: 'pending',
        detail: 'ASI_TG_OPS_ACCEPTANCE_run1 У гостя проблема',
        latestMessages: [],
        createdAt: '2026-06-23T10:00:00.000Z',
      },
      {
        reviewId: 'rev-2',
        targetId: '99323236',
        status: 'pending',
        detail: 'other message',
        latestMessages: [],
        createdAt: '2026-06-23T09:00:00.000Z',
      },
    ]);

    const review = findAcceptanceEscalationReview({
      targetId: '99323236',
      marker: 'ASI_TG_OPS_ACCEPTANCE_run1',
    });

    expect(review?.reviewId).toBe('rev-1');
  });

  it('verifies OPS task fields and dedup without direct task creation helper', async () => {
    const reviewId = 'rev-acceptance';
    const dedupKey = buildAutoOpsDedupKey({
      source: 'communications',
      sourceId: reviewId,
      taskType: 'verify_guest_issue',
    });

    mocks.listOpsOperatorTasks.mockResolvedValue({
      ok: true,
      tasks: [
        {
          id: 'task-1',
          dedupKey,
          source: 'communication_autopilot',
          taskType: 'verify_guest_issue',
          taskStatus: 'needs_operator',
          objectId: null,
          objectLabel: null,
          description: 'Требуется ручная проверка сообщения гостя',
          metadata: { created_by_system: true, integration: 'communications_escalation' },
          createdAt: '2026-06-23T10:00:00.000Z',
          updatedAt: '2026-06-23T10:00:00.000Z',
        },
      ],
    });

    mocks.syncAutoOpsTasks
      .mockResolvedValueOnce({ created: 1, scanned: 2 })
      .mockResolvedValueOnce({ created: 0, scanned: 2 });

    const result = await verifyTelegramOpsTaskForReview(reviewId);

    expect(result.ok).toBe(true);
    expect(result.taskId).toBe('task-1');
    expect(mocks.syncAutoOpsTasks).toHaveBeenCalledTimes(2);
  });

  it('runs done and reopen lifecycle like /dashboard/ops buttons', async () => {
    const taskId = 'task-life';

    mocks.listOpsV1Tasks
      .mockResolvedValueOnce({ ok: true, tasks: [{ id: taskId, status: 'needs_attention' }] })
      .mockResolvedValueOnce({ ok: true, tasks: [] })
      .mockResolvedValueOnce({ ok: true, tasks: [{ id: taskId, status: 'done' }] })
      .mockResolvedValueOnce({ ok: true, tasks: [{ id: taskId, status: 'in_progress' }] });

    mocks.updateOpsV1Task
      .mockResolvedValueOnce({ ok: true, task: { id: taskId, status: 'done' } })
      .mockResolvedValueOnce({ ok: true, task: { id: taskId, status: 'in_progress' } });

    const result = await runTelegramOpsAcceptanceLifecycle(taskId);

    expect(result.ok).toBe(true);
    expect(mocks.updateOpsV1Task).toHaveBeenNthCalledWith(1, taskId, { status: 'done' });
    expect(mocks.updateOpsV1Task).toHaveBeenNthCalledWith(2, taskId, { status: 'in_progress' });
  });
});
