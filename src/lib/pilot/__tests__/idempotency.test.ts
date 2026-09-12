import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPilotChatgptTaskId, createPilotConversationId } from '../ids';
import { resetPilotCreateRateLimitForTests } from '../rate-limit';
import { buildPilotGreenTemplate, PILOT_FIXED_REPOSITORY } from '../template';
import type { RuntimeBridgeTaskRecord } from '@/lib/asi-runtime/bridge-repository';

vi.mock('server-only', () => ({}));

const getRuntimeBridgeClientId = vi.fn(() => 'pilot-client');
const isRuntimeBridgeSupabaseConfigured = vi.fn(() => true);
const findRuntimeBridgeTaskByIdempotencyKey = vi.fn();
const submitRuntimeBridgeTask = vi.fn();
const getRuntimeBridgeTaskRecord = vi.fn();
const listRuntimeBridgeTasks = vi.fn();
const resolveAllowlistedBaselineSha = vi.fn();
const assertPilotSubmissionReady = vi.fn();

vi.mock('@/lib/asi-runtime/bridge-auth', () => ({
  getRuntimeBridgeClientId,
}));

vi.mock('@/lib/asi-runtime/bridge-supabase', () => ({
  isRuntimeBridgeSupabaseConfigured,
}));

vi.mock('../readiness', () => ({
  assertPilotSubmissionReady,
  getPilotReadiness: vi.fn(),
}));

class RuntimeBridgeError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
  ) {
    super(code);
  }
}

vi.mock('@/lib/asi-runtime/bridge-repository', () => ({
  RuntimeBridgeError,
  findRuntimeBridgeTaskByIdempotencyKey,
  submitRuntimeBridgeTask,
  getRuntimeBridgeTaskRecord,
  listRuntimeBridgeTasks,
}));

vi.mock('@/lib/development/baseline-sha', async () => {
  const actual = await vi.importActual<typeof import('@/lib/development/baseline-sha')>(
    '@/lib/development/baseline-sha',
  );
  return {
    ...actual,
    resolveAllowlistedBaselineSha,
  };
});

const GOAL = 'Add a proof markdown under docs/pilot/ for the beta checklist.';
const TITLE = 'Pilot proof';
const NOW = '2026-09-08T00:00:00.000Z';

function matchingRecord(
  pilotUserId: string,
  idempotencyKey: string,
  status: RuntimeBridgeTaskRecord['status'],
): RuntimeBridgeTaskRecord {
  const pkg = buildPilotGreenTemplate({ goal: GOAL, title: TITLE });
  const taskId = randomUUID();
  return {
    taskId,
    chatgptTaskId: createPilotChatgptTaskId(pilotUserId, idempotencyKey),
    conversationId: createPilotConversationId(pilotUserId),
    status,
    attemptCount: status === 'queued' ? 0 : 1,
    createdAt: NOW,
    updatedAt: NOW,
    idempotencyKey,
    requestHash: 'a'.repeat(64),
    request: {
      title: pkg.title,
      objective: pkg.objective,
      instructions: pkg.instructions,
      acceptanceCriteria: [...pkg.acceptanceCriteria],
      safetyConstraints: [...pkg.safetyConstraints],
      repository: pkg.repository,
      baselineSha: 'b'.repeat(40),
    },
  };
}

function blockedReadiness() {
  return import('../errors').then(({ PilotAccessError }) => {
    assertPilotSubmissionReady.mockRejectedValue(
      new PilotAccessError('readiness_blocked', 503, 'Временно недоступно'),
    );
  });
}

beforeEach(() => {
  vi.resetModules();
  resetPilotCreateRateLimitForTests();
  getRuntimeBridgeClientId.mockReset();
  getRuntimeBridgeClientId.mockReturnValue('pilot-client');
  isRuntimeBridgeSupabaseConfigured.mockReset();
  isRuntimeBridgeSupabaseConfigured.mockReturnValue(true);
  findRuntimeBridgeTaskByIdempotencyKey.mockReset();
  findRuntimeBridgeTaskByIdempotencyKey.mockResolvedValue(null);
  submitRuntimeBridgeTask.mockReset();
  getRuntimeBridgeTaskRecord.mockReset();
  listRuntimeBridgeTasks.mockReset();
  resolveAllowlistedBaselineSha.mockReset();
  resolveAllowlistedBaselineSha.mockResolvedValue('b'.repeat(40));
  assertPilotSubmissionReady.mockReset();
  assertPilotSubmissionReady.mockResolvedValue({
    state: 'ready',
    canSubmit: true,
    messageRu: 'ok',
    checkedAt: NOW,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('submitPilotTask idempotency-before-readiness ordering', () => {
  it('returns an already-admitted T1 when readiness later becomes busy', async () => {
    const pilotUserId = 'pilot-idem-a';
    const idempotencyKey = 'pilot-beta-idem-retry-busy';
    const existing = matchingRecord(pilotUserId, idempotencyKey, 'queued');
    findRuntimeBridgeTaskByIdempotencyKey.mockResolvedValue(existing);
    getRuntimeBridgeTaskRecord.mockResolvedValue(existing);
    await blockedReadiness();

    const { submitPilotTask } = await import('../task-service');
    const result = await submitPilotTask({
      pilotUserId,
      body: { goal: GOAL, title: TITLE, idempotencyKey },
    });

    expect(result.deduplicated).toBe(true);
    expect(result.task.taskId).toBe(existing.taskId);
    expect(assertPilotSubmissionReady).not.toHaveBeenCalled();
    expect(submitRuntimeBridgeTask).not.toHaveBeenCalled();
    expect(resolveAllowlistedBaselineSha).not.toHaveBeenCalled();
  });

  it.each([
    'queued',
    'running',
    'awaiting_owner',
    'completed',
    'failed',
  ] as const)('exact retry while %s returns the same T1', async (status) => {
    const pilotUserId = `pilot-idem-${status}`;
    const idempotencyKey = `pilot-beta-idem-retry-${status}`;
    const existing = matchingRecord(pilotUserId, idempotencyKey, status);
    findRuntimeBridgeTaskByIdempotencyKey.mockResolvedValue(existing);
    getRuntimeBridgeTaskRecord.mockResolvedValue(existing);
    await blockedReadiness();

    const { submitPilotTask } = await import('../task-service');
    const result = await submitPilotTask({
      pilotUserId,
      body: { goal: GOAL, title: TITLE, idempotencyKey },
    });

    expect(result.deduplicated).toBe(true);
    expect(result.task.taskId).toBe(existing.taskId);
    expect(result.task.status).toBe(status);
    expect(assertPilotSubmissionReady).not.toHaveBeenCalled();
    expect(submitRuntimeBridgeTask).not.toHaveBeenCalled();
  });

  it('exact retry does not consume a new-create rate-limit slot', async () => {
    const pilotUserId = 'pilot-idem-rate';
    const idempotencyKey = 'pilot-beta-idem-retry-rate';
    const existing = matchingRecord(pilotUserId, idempotencyKey, 'queued');
    findRuntimeBridgeTaskByIdempotencyKey.mockResolvedValue(existing);
    getRuntimeBridgeTaskRecord.mockResolvedValue(existing);

    const rateLimitMod = await import('../rate-limit');
    const consumeCreateSlot = vi.spyOn(rateLimitMod, 'assertPilotCreateRateLimit');
    const { submitPilotTask } = await import('../task-service');
    const result = await submitPilotTask({
      pilotUserId,
      body: { goal: GOAL, title: TITLE, idempotencyKey },
    });
    expect(result.deduplicated).toBe(true);
    expect(result.task.taskId).toBe(existing.taskId);
    expect(consumeCreateSlot).not.toHaveBeenCalled();

    findRuntimeBridgeTaskByIdempotencyKey.mockResolvedValue(null);
    const created = matchingRecord(pilotUserId, 'pilot-beta-idem-retry-rate-new', 'queued');
    submitRuntimeBridgeTask.mockResolvedValue({ task: created, deduplicated: false });
    getRuntimeBridgeTaskRecord.mockResolvedValue(created);
    const createdResult = await submitPilotTask({
      pilotUserId,
      body: {
        goal: GOAL,
        title: TITLE,
        idempotencyKey: 'pilot-beta-idem-retry-rate-new',
      },
    });
    expect(createdResult.deduplicated).toBe(false);
    expect(consumeCreateSlot).toHaveBeenCalledTimes(1);
    expect(consumeCreateSlot).toHaveBeenCalledWith(pilotUserId);
  });

  it('conflicting reuse during busy readiness returns idempotency_conflict, not readiness_blocked', async () => {
    const pilotUserId = 'pilot-idem-conflict';
    const idempotencyKey = 'pilot-beta-idem-conflict-busy';
    const existing = matchingRecord(pilotUserId, idempotencyKey, 'queued');
    findRuntimeBridgeTaskByIdempotencyKey.mockResolvedValue(existing);
    getRuntimeBridgeTaskRecord.mockResolvedValue(existing);
    await blockedReadiness();

    const { submitPilotTask } = await import('../task-service');
    await expect(submitPilotTask({
      pilotUserId,
      body: {
        goal: 'Write a different proof note under docs/pilot/ for conflict.',
        title: 'Different proof',
        idempotencyKey,
      },
    })).rejects.toMatchObject({
      code: 'idempotency_conflict',
      status: 409,
    });
    expect(assertPilotSubmissionReady).not.toHaveBeenCalled();
    expect(submitRuntimeBridgeTask).not.toHaveBeenCalled();
  });

  it('two concurrent exact retries cannot produce duplicate tasks', async () => {
    const store: RuntimeBridgeTaskRecord[] = [];
    findRuntimeBridgeTaskByIdempotencyKey.mockImplementation(async (_clientId, key) => (
      store.find((row) => row.idempotencyKey === key) ?? null
    ));
    submitRuntimeBridgeTask.mockImplementation(async (_clientId, input) => {
      const existing = store.find((row) => row.idempotencyKey === input.idempotencyKey);
      if (existing) {
        return { task: existing, deduplicated: true };
      }
      const created = matchingRecord('pilot-idem-race', input.idempotencyKey, 'queued');
      created.chatgptTaskId = input.chatgptTaskId;
      created.conversationId = input.conversationId;
      store.push(created);
      getRuntimeBridgeTaskRecord.mockImplementation(async (_id, taskId) => {
        const row = store.find((item) => item.taskId === taskId);
        if (!row) throw new RuntimeBridgeError('task_not_found', 404);
        return row;
      });
      return { task: created, deduplicated: false };
    });

    const { submitPilotTask } = await import('../task-service');
    const body = {
      goal: GOAL,
      title: TITLE,
      idempotencyKey: 'pilot-beta-idem-concurrent',
    };
    const [left, right] = await Promise.all([
      submitPilotTask({ pilotUserId: 'pilot-idem-race', body }),
      submitPilotTask({ pilotUserId: 'pilot-idem-race', body }),
    ]);

    expect(store).toHaveLength(1);
    expect(left.task.taskId).toBe(store[0]!.taskId);
    expect(right.task.taskId).toBe(store[0]!.taskId);
    expect([left.deduplicated, right.deduplicated].filter(Boolean).length).toBeGreaterThanOrEqual(1);
  });

  it('a genuinely new key while busy still fails closed', async () => {
    findRuntimeBridgeTaskByIdempotencyKey.mockResolvedValue(null);
    await blockedReadiness();

    const { submitPilotTask } = await import('../task-service');
    await expect(submitPilotTask({
      pilotUserId: 'pilot-idem-new-busy',
      body: {
        goal: GOAL,
        title: TITLE,
        idempotencyKey: 'pilot-beta-idem-new-while-busy',
      },
    })).rejects.toMatchObject({ code: 'readiness_blocked', status: 503 });
    expect(assertPilotSubmissionReady).toHaveBeenCalledTimes(1);
    expect(submitRuntimeBridgeTask).not.toHaveBeenCalled();
  });

  it('cross-user lookup cannot expose or return another user task', async () => {
    const ownerA = 'pilot-idem-owner-a';
    const ownerB = 'pilot-idem-owner-b';
    const idempotencyKey = 'pilot-beta-idem-shared-key';
    const existing = matchingRecord(ownerA, idempotencyKey, 'queued');
    findRuntimeBridgeTaskByIdempotencyKey.mockResolvedValue(existing);
    getRuntimeBridgeTaskRecord.mockResolvedValue(existing);
    await blockedReadiness();

    const { submitPilotTask } = await import('../task-service');
    await expect(submitPilotTask({
      pilotUserId: ownerB,
      body: { goal: GOAL, title: TITLE, idempotencyKey },
    })).rejects.toMatchObject({
      code: 'task_not_found',
      status: 404,
      messageRu: 'Задача не найдена.',
    });
    expect(submitRuntimeBridgeTask).not.toHaveBeenCalled();
    expect(assertPilotSubmissionReady).not.toHaveBeenCalled();
  });

  it('still rejects privileged and invalid input before idempotency lookup', async () => {
    const { submitPilotTask } = await import('../task-service');
    await expect(submitPilotTask({
      pilotUserId: 'pilot-idem-invalid',
      body: {
        goal: GOAL,
        idempotencyKey: 'pilot-beta-idem-privileged',
        baselineSha: 'c'.repeat(40),
      },
    })).rejects.toMatchObject({ code: 'privileged_field_forbidden', status: 400 });
    await expect(submitPilotTask({
      pilotUserId: 'pilot-idem-invalid',
      body: {
        goal: 'Merge to main and deploy production.',
        idempotencyKey: 'pilot-beta-idem-red',
      },
    })).rejects.toMatchObject({ code: 'red_objective_rejected', status: 400 });
    expect(findRuntimeBridgeTaskByIdempotencyKey).not.toHaveBeenCalled();
    expect(assertPilotSubmissionReady).not.toHaveBeenCalled();
  });
});
