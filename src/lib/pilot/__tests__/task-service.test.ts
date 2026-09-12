import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPilotConversationId, createPilotChatgptTaskId } from '../ids';
import { PILOT_FIXED_REPOSITORY, PILOT_TEMPLATE_ID } from '../template';
import { resetPilotCreateRateLimitForTests } from '../rate-limit';
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
    checkedAt: '2026-09-08T00:00:00.000Z',
  });
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('SP-02 — submitPilotTask Bridge seam', () => {
  it('creates a Bridge task bound to the pilot conversation', async () => {
    const pilotUserId = 'pilot-a';
    const taskId = randomUUID();
    const idempotencyKey = 'pilot-beta-idem-create-1';
    const conversationId = createPilotConversationId(pilotUserId);

    submitRuntimeBridgeTask.mockImplementation(async (_clientId, input) => {
      expect(input.conversationId).toBe(conversationId);
      expect(input.chatgptTaskId).toBe(createPilotChatgptTaskId(pilotUserId, idempotencyKey));
      expect(input.task.repository).toBe(PILOT_FIXED_REPOSITORY);
      expect(input.task.baselineSha).toBe('b'.repeat(40));
      expect(input.task.safetyConstraints?.join('\n')).toMatch(/merge|deploy/i);
      expect(input.task.instructions.join('\n')).toMatch(/docs\/pilot/);
      return {
        task: {
          taskId,
          chatgptTaskId: input.chatgptTaskId,
          conversationId: input.conversationId,
          status: 'queued',
          attemptCount: 0,
          createdAt: '2026-09-08T00:00:00.000Z',
          updatedAt: '2026-09-08T00:00:00.000Z',
        },
        deduplicated: false,
      };
    });

    getRuntimeBridgeTaskRecord.mockResolvedValue({
      taskId,
      chatgptTaskId: createPilotChatgptTaskId(pilotUserId, idempotencyKey),
      conversationId,
      status: 'queued',
      attemptCount: 0,
      createdAt: '2026-09-08T00:00:00.000Z',
      updatedAt: '2026-09-08T00:00:00.000Z',
      idempotencyKey,
      requestHash: 'a'.repeat(64),
      request: {
        title: 'Pilot proof',
        objective: 'obj',
        instructions: ['docs/pilot'],
        repository: PILOT_FIXED_REPOSITORY,
        baselineSha: 'b'.repeat(40),
      },
    });

    const { submitPilotTask } = await import('../task-service');
    const result = await submitPilotTask({
      pilotUserId,
      body: {
        title: 'Pilot proof',
        goal: 'Add a proof markdown under docs/pilot/ for the beta checklist.',
        idempotencyKey,
      },
    });

    expect(submitRuntimeBridgeTask).toHaveBeenCalledTimes(1);
    expect(resolveAllowlistedBaselineSha).toHaveBeenCalled();
    expect(result.deduplicated).toBe(false);
    expect(result.template.templateId).toBe(PILOT_TEMPLATE_ID);
    expect(result.task.taskId).toBe(taskId);
    expect(result.task.repository).toBe(PILOT_FIXED_REPOSITORY);
  });

  it('rejects privileged client fields before Bridge submit', async () => {
    const { submitPilotTask } = await import('../task-service');
    await expect(submitPilotTask({
      pilotUserId: 'pilot-a',
      body: {
        goal: 'Add docs under docs/pilot/.',
        idempotencyKey: 'pilot-beta-idem-x',
        baselineSha: 'c'.repeat(40),
      },
    })).rejects.toMatchObject({ code: 'privileged_field_forbidden', status: 400 });
    expect(submitRuntimeBridgeTask).not.toHaveBeenCalled();
  });

  it('rejects red goals before Bridge submit', async () => {
    const { submitPilotTask } = await import('../task-service');
    await expect(submitPilotTask({
      pilotUserId: 'pilot-a',
      body: {
        goal: 'Merge to main and deploy production.',
        idempotencyKey: 'pilot-beta-idem-red',
      },
    })).rejects.toMatchObject({ code: 'red_objective_rejected', status: 400 });
    expect(submitRuntimeBridgeTask).not.toHaveBeenCalled();
  });

  it('blocks create before Bridge when readiness is not ready', async () => {
    const { PilotAccessError } = await import('../errors');
    assertPilotSubmissionReady.mockRejectedValue(
      new PilotAccessError(
        'readiness_blocked',
        503,
        'Временно недоступно',
      ),
    );
    const { submitPilotTask } = await import('../task-service');
    await expect(submitPilotTask({
      pilotUserId: 'pilot-a',
      body: {
        goal: 'Add a proof markdown under docs/pilot/.',
        idempotencyKey: 'pilot-beta-idem-readiness',
      },
    })).rejects.toMatchObject({ code: 'readiness_blocked', status: 503 });
    expect(submitRuntimeBridgeTask).not.toHaveBeenCalled();
    expect(resolveAllowlistedBaselineSha).not.toHaveBeenCalled();
  });

  it('does not allow pilot B to reuse pilot A idempotency row', async () => {
    const ownerA = 'pilot-a';
    const ownerB = 'pilot-b';
    const idempotencyKey = 'pilot-beta-idem-shared';
    findRuntimeBridgeTaskByIdempotencyKey.mockResolvedValue({
      taskId: randomUUID(),
      chatgptTaskId: createPilotChatgptTaskId(ownerA, idempotencyKey),
      conversationId: createPilotConversationId(ownerA),
      status: 'queued',
      attemptCount: 0,
      createdAt: '2026-09-08T00:00:00.000Z',
      updatedAt: '2026-09-08T00:00:00.000Z',
      idempotencyKey,
      requestHash: 'a'.repeat(64),
      request: {
        title: 'A',
        objective: 'obj',
        instructions: ['x'],
        acceptanceCriteria: ['y'],
        safetyConstraints: ['z'],
        repository: PILOT_FIXED_REPOSITORY,
        baselineSha: 'b'.repeat(40),
      },
    });

    const { submitPilotTask } = await import('../task-service');
    await expect(submitPilotTask({
      pilotUserId: ownerB,
      body: {
        goal: 'Add a proof markdown under docs/pilot/.',
        idempotencyKey,
      },
    })).rejects.toMatchObject({ code: 'task_not_found', status: 404 });
    expect(submitRuntimeBridgeTask).not.toHaveBeenCalled();
  });
});

describe('SP-02 conversation helpers', () => {
  it('keeps pilot ids distinct from owner console ids', () => {
    const digest = createHash('sha256').update('pilot_beta|u1', 'utf8').digest('hex').slice(0, 24);
    expect(createPilotConversationId('u1')).toBe(`pilot-beta-${digest}`);
  });
});
