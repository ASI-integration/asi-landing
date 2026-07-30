import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const ORIGINAL_ENV = { ...process.env };

const getRuntimeBridgeClientId = vi.fn(() => 'chatgpt-owner');
const submitRuntimeBridgeTask = vi.fn();
const getRuntimeBridgeTask = vi.fn();
const getRuntimeBridgeResult = vi.fn();
const listRuntimeBridgeOwnerGates = vi.fn();
const submitRuntimeBridgeOwnerDecision = vi.fn();
const resolveAllowlistedBaselineSha = vi.fn();

vi.mock('@/lib/asi-runtime/bridge-auth', () => ({
  getRuntimeBridgeClientId,
}));

vi.mock('@/lib/asi-runtime/bridge-repository', () => ({
  RuntimeBridgeError: class RuntimeBridgeError extends Error {
    constructor(
      public readonly code: string,
      public readonly status: number,
    ) {
      super(code);
    }
  },
  submitRuntimeBridgeTask,
  getRuntimeBridgeTask,
  getRuntimeBridgeResult,
  listRuntimeBridgeOwnerGates,
  submitRuntimeBridgeOwnerDecision,
}));

vi.mock('@/lib/development/baseline-sha', async () => {
  const actual = await vi.importActual<typeof import('../baseline-sha')>('../baseline-sha');
  return {
    ...actual,
    resolveAllowlistedBaselineSha,
  };
});

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.ASI_RUNTIME_BRIDGE_CLIENT_ID = 'chatgpt-owner';
  vi.resetModules();
  getRuntimeBridgeClientId.mockReturnValue('chatgpt-owner');
  submitRuntimeBridgeTask.mockReset();
  getRuntimeBridgeTask.mockReset();
  getRuntimeBridgeResult.mockReset();
  listRuntimeBridgeOwnerGates.mockReset();
  submitRuntimeBridgeOwnerDecision.mockReset();
  resolveAllowlistedBaselineSha.mockReset();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

const taskView = {
  taskId: '11111111-1111-4111-8111-111111111111',
  chatgptTaskId: 'dev-console-task-1',
  conversationId: 'dev-console-owner-1',
  status: 'queued' as const,
  attemptCount: 0,
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
};

describe('submitDevelopmentTask', () => {
  it('rejects non-allowlisted repositories', async () => {
    const { submitDevelopmentTask, DevelopmentConsoleError } = await import('../task-service');
    await expect(
      submitDevelopmentTask({
        ownerUserId: 'user-1',
        repositoryId: 'other-repo',
        title: 'Title',
        objective: 'Objective',
        instructions: 'Do the thing',
      }),
    ).rejects.toBeInstanceOf(DevelopmentConsoleError);
    expect(submitRuntimeBridgeTask).not.toHaveBeenCalled();
  });

  it('rejects browser-supplied baseline SHA', async () => {
    const { submitDevelopmentTask } = await import('../task-service');
    await expect(
      submitDevelopmentTask({
        ownerUserId: 'user-1',
        repositoryId: 'asi-landing',
        title: 'Title',
        objective: 'Objective',
        instructions: 'Do the thing',
        baselineSha: 'a'.repeat(40),
      }),
    ).rejects.toMatchObject({ code: 'baseline_sha_forbidden' });
    expect(resolveAllowlistedBaselineSha).not.toHaveBeenCalled();
  });

  it('resolves baseline SHA on the server and submits to Runtime Bridge', async () => {
    const sha = 'c'.repeat(40);
    resolveAllowlistedBaselineSha.mockResolvedValue(sha);
    submitRuntimeBridgeTask.mockResolvedValue({ task: taskView, deduplicated: false });
    getRuntimeBridgeTask.mockResolvedValue(taskView);
    listRuntimeBridgeOwnerGates.mockResolvedValue([]);

    const { submitDevelopmentTask } = await import('../task-service');
    const result = await submitDevelopmentTask({
      ownerUserId: 'user-1',
      repositoryId: 'asi-landing',
      title: 'Title',
      objective: 'Objective',
      instructions: 'Do the thing',
      idempotencyKey: 'dev-console-idem-abc',
    });

    expect(resolveAllowlistedBaselineSha).toHaveBeenCalled();
    expect(submitRuntimeBridgeTask).toHaveBeenCalledWith(
      'chatgpt-owner',
      expect.objectContaining({
        idempotencyKey: 'dev-console-idem-abc',
        task: expect.objectContaining({
          repository: 'ASI-integration/asi-landing',
          baselineSha: sha,
        }),
      }),
    );
    expect(result.snapshot.task.taskId).toBe(taskView.taskId);
    expect(JSON.stringify(result)).not.toMatch(/ASI_RUNTIME_BRIDGE|SERVICE_ROLE|TOKEN/i);
  });

  it('maps malformed/unavailable baseline SHA to a safe error', async () => {
    const { BaselineShaError } = await import('../baseline-sha');
    resolveAllowlistedBaselineSha.mockRejectedValue(new BaselineShaError('baseline_sha_invalid'));
    const { submitDevelopmentTask } = await import('../task-service');
    await expect(
      submitDevelopmentTask({
        ownerUserId: 'user-1',
        repositoryId: 'asi-landing',
        title: 'Title',
        objective: 'Objective',
        instructions: 'Do the thing',
      }),
    ).rejects.toMatchObject({ code: 'baseline_sha_invalid', status: 502 });
  });

  it('returns deduplicated=true for an idempotent duplicate submit', async () => {
    resolveAllowlistedBaselineSha.mockResolvedValue('d'.repeat(40));
    submitRuntimeBridgeTask.mockResolvedValue({ task: taskView, deduplicated: true });
    getRuntimeBridgeTask.mockResolvedValue(taskView);

    const { submitDevelopmentTask } = await import('../task-service');
    const first = await submitDevelopmentTask({
      ownerUserId: 'user-1',
      repositoryId: 'asi-landing',
      title: 'Title',
      objective: 'Objective',
      instructions: 'Do the thing',
      idempotencyKey: 'dev-console-idem-same',
    });
    const second = await submitDevelopmentTask({
      ownerUserId: 'user-1',
      repositoryId: 'asi-landing',
      title: 'Title',
      objective: 'Objective',
      instructions: 'Do the thing',
      idempotencyKey: 'dev-console-idem-same',
    });
    expect(first.deduplicated).toBe(true);
    expect(second.deduplicated).toBe(true);
    expect(first.snapshot.task.taskId).toBe(second.snapshot.task.taskId);
  });
});

describe('submitDevelopmentOwnerDecision', () => {
  const gate = {
    schemaVersion: 'asi.runtime.owner-gate.v1' as const,
    action: 'create_pull_request',
    exactTarget: 'branch/feature',
    identity: 'runner',
    reason: 'needs approval',
    evidence: ['diff ready'],
    allowedSideEffect: 'open draft PR',
    rollback: 'close PR',
    postActionVerification: ['PR URL exists'],
    taskCycle: 'cycle-1',
    expiresAt: '2099-01-01T00:00:00.000Z',
    gateId: '22222222-2222-4222-8222-222222222222',
    taskId: '11111111-1111-4111-8111-111111111111',
    status: 'pending' as const,
    createdAt: '2026-07-30T00:00:00.000Z',
  };

  it('approves with server-forced source and deterministic decisionId', async () => {
    listRuntimeBridgeOwnerGates.mockResolvedValue([gate]);
    submitRuntimeBridgeOwnerDecision.mockResolvedValue({
      task: { ...taskView, status: 'queued' },
      gate: { ...gate, status: 'approved' },
      deduplicated: false,
    });
    getRuntimeBridgeTask.mockResolvedValue({ ...taskView, status: 'queued' });

    const { submitDevelopmentOwnerDecision } = await import('../task-service');
    const result = await submitDevelopmentOwnerDecision({
      taskId: gate.taskId,
      gateId: gate.gateId,
      taskCycle: gate.taskCycle,
      decision: 'approved',
    });

    expect(submitRuntimeBridgeOwnerDecision).toHaveBeenCalledWith(
      'chatgpt-owner',
      expect.objectContaining({
        source: 'explicit_owner_message',
        decision: 'approved',
        decisionId: expect.stringMatching(/^dev-console-decision-[0-9a-f]{32}$/),
      }),
    );
    expect(result.snapshot.task.status).toBe('queued');
  });

  it('rejects a gate that belongs to another task', async () => {
    listRuntimeBridgeOwnerGates.mockResolvedValue([
      { ...gate, taskId: '33333333-3333-4333-8333-333333333333' },
    ]);
    const { submitDevelopmentOwnerDecision } = await import('../task-service');
    await expect(
      submitDevelopmentOwnerDecision({
        taskId: gate.taskId,
        gateId: gate.gateId,
        taskCycle: gate.taskCycle,
        decision: 'approved',
      }),
    ).rejects.toMatchObject({ code: 'owner_gate_mismatch' });
    expect(submitRuntimeBridgeOwnerDecision).not.toHaveBeenCalled();
  });

  it('rejects an expired gate', async () => {
    listRuntimeBridgeOwnerGates.mockResolvedValue([
      { ...gate, expiresAt: '2000-01-01T00:00:00.000Z' },
    ]);
    const { submitDevelopmentOwnerDecision } = await import('../task-service');
    await expect(
      submitDevelopmentOwnerDecision({
        taskId: gate.taskId,
        gateId: gate.gateId,
        taskCycle: gate.taskCycle,
        decision: 'rejected',
      }),
    ).rejects.toMatchObject({ code: 'owner_gate_expired' });
  });

  it('is idempotent for an exact duplicate decision', async () => {
    listRuntimeBridgeOwnerGates.mockResolvedValue([gate]);
    submitRuntimeBridgeOwnerDecision.mockResolvedValue({
      task: { ...taskView, status: 'failed' },
      gate: { ...gate, status: 'rejected' },
      deduplicated: true,
    });
    getRuntimeBridgeTask.mockResolvedValue({ ...taskView, status: 'failed' });
    getRuntimeBridgeResult.mockResolvedValue({
      taskId: taskView.taskId,
      status: 'failed',
      result: {
        schemaVersion: 'asi.runtime.result.v1',
        status: 'failed',
        summary: 'Owner rejected the requested action.',
        changedFiles: [],
        checks: [],
        artifacts: [],
        blockers: [],
      },
    });

    const { submitDevelopmentOwnerDecision } = await import('../task-service');
    const result = await submitDevelopmentOwnerDecision({
      taskId: gate.taskId,
      gateId: gate.gateId,
      taskCycle: gate.taskCycle,
      decision: 'rejected',
    });
    expect(result.deduplicated).toBe(true);
    expect(result.snapshot.task.status).toBe('failed');
  });
});
