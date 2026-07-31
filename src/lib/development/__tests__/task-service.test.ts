import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runtimeBridgeRequestHash } from '@/lib/asi-runtime/bridge-hash';
import type {
  RuntimeBridgeOwnerGateView,
  RuntimeBridgeTaskRequest,
  RuntimeBridgeTaskView,
} from '@/lib/asi-runtime/bridge-types';

vi.mock('server-only', () => ({}));

const ORIGINAL_ENV = { ...process.env };

const getRuntimeBridgeClientId = vi.fn(() => 'chatgpt-owner');
const submitRuntimeBridgeTask = vi.fn();
const findRuntimeBridgeTaskByIdempotencyKey = vi.fn();
const getRuntimeBridgeTask = vi.fn();
const getRuntimeBridgeResult = vi.fn();
const listRuntimeBridgeOwnerGates = vi.fn();
const getRuntimeBridgeOwnerGate = vi.fn();
const submitRuntimeBridgeOwnerDecision = vi.fn();
const resolveAllowlistedBaselineSha = vi.fn();

vi.mock('@/lib/asi-runtime/bridge-auth', () => ({
  getRuntimeBridgeClientId,
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
  submitRuntimeBridgeTask,
  findRuntimeBridgeTaskByIdempotencyKey,
  getRuntimeBridgeTask,
  getRuntimeBridgeResult,
  listRuntimeBridgeOwnerGates,
  getRuntimeBridgeOwnerGate,
  submitRuntimeBridgeOwnerDecision,
}));

vi.mock('@/lib/development/baseline-sha', async () => {
  const actual = await vi.importActual<typeof import('../baseline-sha')>('../baseline-sha');
  return {
    ...actual,
    resolveAllowlistedBaselineSha,
  };
});

function conversationIdFor(ownerUserId: string): string {
  const digest = createHash('sha256').update(ownerUserId, 'utf8').digest('hex').slice(0, 24);
  return `dev-console-owner-${digest}`;
}

function chatgptTaskIdFor(ownerUserId: string, idempotencyKey: string): string {
  const digest = createHash('sha256')
    .update(`${ownerUserId}|${idempotencyKey}`, 'utf8')
    .digest('hex')
    .slice(0, 32);
  return `dev-console-task-${digest}`;
}

function decisionIdFor(input: {
  taskId: string;
  gateId: string;
  taskCycle: string;
  decision: 'approved' | 'rejected';
}): string {
  const digest = createHash('sha256')
    .update(`${input.taskId}|${input.gateId}|${input.taskCycle}|${input.decision}`, 'utf8')
    .digest('hex')
    .slice(0, 32);
  return `dev-console-decision-${digest}`;
}

type DurableTask = RuntimeBridgeTaskView & {
  idempotencyKey: string;
  requestHash: string;
  request: RuntimeBridgeTaskRequest;
};

type DurableGate = RuntimeBridgeOwnerGateView & {
  decisionId?: string;
  decision?: Record<string, unknown>;
};

function createCompatibleBridge() {
  const tasks = new Map<string, DurableTask>();
  const byIdempotency = new Map<string, string>();
  const gates = new Map<string, DurableGate>();

  findRuntimeBridgeTaskByIdempotencyKey.mockImplementation(async (_clientId: string, key: string) => {
    const taskId = byIdempotency.get(key);
    return taskId ? tasks.get(taskId) ?? null : null;
  });

  submitRuntimeBridgeTask.mockImplementation(async (_clientId: string, input: {
    chatgptTaskId: string;
    conversationId: string;
    idempotencyKey: string;
    task: RuntimeBridgeTaskRequest;
  }) => {
    const requestHash = runtimeBridgeRequestHash(input.task);
    const existingId = byIdempotency.get(input.idempotencyKey);
    if (existingId) {
      const existing = tasks.get(existingId)!;
      if (
        existing.requestHash !== requestHash
        || existing.chatgptTaskId !== input.chatgptTaskId
        || existing.conversationId !== input.conversationId
      ) {
        throw new RuntimeBridgeError('idempotency_conflict', 409);
      }
      return { task: existing, deduplicated: true };
    }

    const task: DurableTask = {
      taskId: randomUUID(),
      chatgptTaskId: input.chatgptTaskId,
      conversationId: input.conversationId,
      status: 'queued',
      attemptCount: 0,
      createdAt: '2026-07-30T00:00:00.000Z',
      updatedAt: '2026-07-30T00:00:00.000Z',
      idempotencyKey: input.idempotencyKey,
      requestHash,
      request: input.task,
    };
    tasks.set(task.taskId, task);
    byIdempotency.set(input.idempotencyKey, task.taskId);
    return { task, deduplicated: false };
  });

  getRuntimeBridgeTask.mockImplementation(async (_clientId: string, taskId: string) => {
    const task = tasks.get(taskId);
    if (!task) throw new RuntimeBridgeError('task_not_found', 404);
    return task;
  });

  getRuntimeBridgeResult.mockImplementation(async (_clientId: string, taskId: string) => {
    const task = tasks.get(taskId);
    if (!task) throw new RuntimeBridgeError('task_not_found', 404);
    return {
      taskId,
      status: task.status,
      result: task.status === 'failed'
        ? {
            schemaVersion: 'asi.runtime.result.v1',
            status: 'failed',
            summary: 'Owner rejected the requested action.',
            changedFiles: [],
            checks: [],
            artifacts: [],
            blockers: [],
          }
        : null,
    };
  });

  listRuntimeBridgeOwnerGates.mockImplementation(async () => (
    [...gates.values()].filter((gate) => gate.status === 'pending')
  ));

  getRuntimeBridgeOwnerGate.mockImplementation(async (_clientId: string, gateId: string) => (
    gates.get(gateId) ?? null
  ));

  submitRuntimeBridgeOwnerDecision.mockImplementation(async (_clientId: string, input: {
    taskId: string;
    gateId: string;
    decisionId: string;
    taskCycle: string;
    decision: 'approved' | 'rejected';
    source: 'explicit_owner_message';
    note?: string;
  }) => {
    const gate = gates.get(input.gateId);
    const task = tasks.get(input.taskId);
    if (!gate || !task || gate.taskId !== input.taskId || gate.taskCycle !== input.taskCycle) {
      throw new RuntimeBridgeError('owner_gate_mismatch', 409);
    }

    const payload = {
      decisionId: input.decisionId,
      decision: input.decision,
      source: input.source,
      taskCycle: input.taskCycle,
      note: input.note ?? null,
      gateId: gate.gateId,
      ownerGate: {
        schemaVersion: gate.schemaVersion,
        action: gate.action,
        exactTarget: gate.exactTarget,
        identity: gate.identity,
        reason: gate.reason,
        evidence: gate.evidence,
        allowedSideEffect: gate.allowedSideEffect,
        rollback: gate.rollback,
        postActionVerification: gate.postActionVerification,
        taskCycle: gate.taskCycle,
        expiresAt: gate.expiresAt,
      },
    };

    if (gate.status !== 'pending') {
      if (gate.decisionId === input.decisionId && JSON.stringify(gate.decision) === JSON.stringify(payload)) {
        return { task, gate, deduplicated: true };
      }
      throw new RuntimeBridgeError('decision_conflict', 409);
    }

    if (Date.parse(gate.expiresAt) <= Date.now()) {
      throw new RuntimeBridgeError('owner_gate_mismatch', 409);
    }

    gate.status = input.decision;
    gate.decisionId = input.decisionId;
    gate.decision = payload;
    task.status = input.decision === 'approved' ? 'queued' : 'failed';
    task.updatedAt = '2026-07-30T00:02:00.000Z';
    return { task, gate, deduplicated: false };
  });

  return {
    tasks,
    gates,
    seedTask(task: DurableTask) {
      tasks.set(task.taskId, task);
      byIdempotency.set(task.idempotencyKey, task.taskId);
    },
    seedGate(gate: DurableGate) {
      gates.set(gate.gateId, gate);
    },
  };
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  process.env.ASI_RUNTIME_BRIDGE_CLIENT_ID = 'chatgpt-owner';
  process.env.ASI_RUNTIME_BRIDGE_SUPABASE_URL = 'https://bridge-isolated.supabase.co';
  process.env.ASI_RUNTIME_BRIDGE_SUPABASE_SERVICE_ROLE_KEY = 'bridge-service-role-key-for-isolated-project';
  vi.resetModules();
  getRuntimeBridgeClientId.mockReturnValue('chatgpt-owner');
  submitRuntimeBridgeTask.mockReset();
  findRuntimeBridgeTaskByIdempotencyKey.mockReset();
  getRuntimeBridgeTask.mockReset();
  getRuntimeBridgeResult.mockReset();
  listRuntimeBridgeOwnerGates.mockReset();
  getRuntimeBridgeOwnerGate.mockReset();
  submitRuntimeBridgeOwnerDecision.mockReset();
  resolveAllowlistedBaselineSha.mockReset();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

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
        idempotencyKey: 'dev-console-idem-abc',
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
        idempotencyKey: 'dev-console-idem-abc',
        baselineSha: 'a'.repeat(40),
      }),
    ).rejects.toMatchObject({ code: 'baseline_sha_forbidden' });
    expect(resolveAllowlistedBaselineSha).not.toHaveBeenCalled();
  });

  it('returns a safe Russian 503 when Bridge Supabase URL is missing', async () => {
    delete process.env.ASI_RUNTIME_BRIDGE_SUPABASE_URL;
    const { submitDevelopmentTask, DevelopmentConsoleError } = await import('../task-service');
    await expect(
      submitDevelopmentTask({
        ownerUserId: 'user-1',
        repositoryId: 'asi-landing',
        title: 'Title',
        objective: 'Objective',
        instructions: 'Do the thing',
        idempotencyKey: 'dev-console-idem-abc',
      }),
    ).rejects.toMatchObject({
      code: 'bridge_not_configured',
      status: 503,
      messageRu: 'Runtime Bridge не настроен.',
    });
    try {
      await submitDevelopmentTask({
        ownerUserId: 'user-1',
        repositoryId: 'asi-landing',
        title: 'Title',
        objective: 'Objective',
        instructions: 'Do the thing',
        idempotencyKey: 'dev-console-idem-abc',
      });
    } catch (error) {
      expect(error).toBeInstanceOf(DevelopmentConsoleError);
      expect(JSON.stringify(error)).not.toMatch(/SERVICE_ROLE|https?:\/\/|supabase\.co|bridge-service-role/i);
    }
    expect(submitRuntimeBridgeTask).not.toHaveBeenCalled();
  });

  it('returns a safe Russian 503 when Bridge service-role key is missing', async () => {
    delete process.env.ASI_RUNTIME_BRIDGE_SUPABASE_SERVICE_ROLE_KEY;
    const { submitDevelopmentTask } = await import('../task-service');
    await expect(
      submitDevelopmentTask({
        ownerUserId: 'user-1',
        repositoryId: 'asi-landing',
        title: 'Title',
        objective: 'Objective',
        instructions: 'Do the thing',
        idempotencyKey: 'dev-console-idem-abc',
      }),
    ).rejects.toMatchObject({
      code: 'bridge_not_configured',
      status: 503,
      messageRu: 'Runtime Bridge не настроен.',
    });
    expect(submitRuntimeBridgeTask).not.toHaveBeenCalled();
  });

  it('rejects missing or malformed idempotency keys with 400', async () => {
    const { submitDevelopmentTask } = await import('../task-service');
    await expect(
      submitDevelopmentTask({
        ownerUserId: 'user-1',
        repositoryId: 'asi-landing',
        title: 'Title',
        objective: 'Objective',
        instructions: 'Do the thing',
      }),
    ).rejects.toMatchObject({ code: 'idempotency_key_required', status: 400 });
    await expect(
      submitDevelopmentTask({
        ownerUserId: 'user-1',
        repositoryId: 'asi-landing',
        title: 'Title',
        objective: 'Objective',
        instructions: 'Do the thing',
        idempotencyKey: 'bad key with spaces',
      }),
    ).rejects.toMatchObject({ code: 'idempotency_key_required', status: 400 });
    expect(submitRuntimeBridgeTask).not.toHaveBeenCalled();
  });

  it('resolves baseline SHA on the server and submits to Runtime Bridge', async () => {
    const bridge = createCompatibleBridge();
    const sha = 'c'.repeat(40);
    resolveAllowlistedBaselineSha.mockResolvedValue(sha);

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
        chatgptTaskId: chatgptTaskIdFor('user-1', 'dev-console-idem-abc'),
        conversationId: conversationIdFor('user-1'),
        idempotencyKey: 'dev-console-idem-abc',
        task: expect.objectContaining({
          repository: 'ASI-integration/asi-landing',
          baselineSha: sha,
        }),
      }),
    );
    expect(result.deduplicated).toBe(false);
    expect(result.snapshot.task.taskId).toBe([...bridge.tasks.keys()][0]);
    expect(JSON.stringify(result)).not.toMatch(/ASI_RUNTIME_BRIDGE|SERVICE_ROLE|TOKEN/i);
  });

  it('maps malformed/unavailable baseline SHA to a safe error', async () => {
    findRuntimeBridgeTaskByIdempotencyKey.mockResolvedValue(null);
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
        idempotencyKey: 'dev-console-idem-abc',
      }),
    ).rejects.toMatchObject({ code: 'baseline_sha_invalid', status: 502 });
  });

  it('deduplicates exact retries via durable lookup without requiring Bridge auto-dedupe mocks', async () => {
    createCompatibleBridge();
    resolveAllowlistedBaselineSha.mockResolvedValueOnce('d'.repeat(40));

    const { submitDevelopmentTask } = await import('../task-service');
    const first = await submitDevelopmentTask({
      ownerUserId: 'user-1',
      repositoryId: 'asi-landing',
      title: 'Title',
      objective: 'Objective',
      instructions: 'Do the thing',
      idempotencyKey: 'dev-console-idem-same',
    });

    // Baseline tip changes between attempts — recovery must not resolve a new SHA.
    resolveAllowlistedBaselineSha.mockResolvedValueOnce('e'.repeat(40));
    const second = await submitDevelopmentTask({
      ownerUserId: 'user-1',
      repositoryId: 'asi-landing',
      title: 'Title',
      objective: 'Objective',
      instructions: 'Do the thing',
      idempotencyKey: 'dev-console-idem-same',
    });

    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(second.snapshot.task.taskId).toBe(first.snapshot.task.taskId);
    expect(submitRuntimeBridgeTask).toHaveBeenCalledTimes(1);
    expect(resolveAllowlistedBaselineSha).toHaveBeenCalledTimes(1);

    const submitArgs = submitRuntimeBridgeTask.mock.calls[0][1];
    expect(submitArgs.chatgptTaskId).toBe(chatgptTaskIdFor('user-1', 'dev-console-idem-same'));
    expect(submitArgs.conversationId).toBe(conversationIdFor('user-1'));
    expect(submitArgs.task.baselineSha).toBe('d'.repeat(40));
  });

  it('accepts up to 100 non-empty instruction lines and rejects 101', async () => {
    createCompatibleBridge();
    resolveAllowlistedBaselineSha.mockResolvedValue('a'.repeat(40));
    const { submitDevelopmentTask } = await import('../task-service');

    const hundred = Array.from({ length: 100 }, (_, index) => `step-${index + 1}`);
    const accepted = await submitDevelopmentTask({
      ownerUserId: 'user-1',
      repositoryId: 'asi-landing',
      title: 'Title',
      objective: 'Objective',
      instructions: hundred,
      idempotencyKey: 'dev-console-idem-100-lines',
    });
    expect(accepted.deduplicated).toBe(false);
    expect(submitRuntimeBridgeTask.mock.calls[0][1].task.instructions).toHaveLength(100);

    await expect(
      submitDevelopmentTask({
        ownerUserId: 'user-1',
        repositoryId: 'asi-landing',
        title: 'Title',
        objective: 'Objective',
        instructions: [...hundred, 'step-101'],
        idempotencyKey: 'dev-console-idem-101-lines',
      }),
    ).rejects.toMatchObject({ code: 'invalid_task_fields', status: 400 });
  });

  it('rejects instruction payloads that exceed the total content limit', async () => {
    const { submitDevelopmentTask } = await import('../task-service');
    const { RUNTIME_BRIDGE_MAX_INSTRUCTION_TOTAL_CHARS } = await import('@/lib/asi-runtime/bridge-schema');
    const line = 'x'.repeat(2000);
    const oversized = Array.from(
      { length: Math.floor(RUNTIME_BRIDGE_MAX_INSTRUCTION_TOTAL_CHARS / 2000) + 1 },
      () => line,
    );
    expect(oversized.length).toBeLessThanOrEqual(100);
    await expect(
      submitDevelopmentTask({
        ownerUserId: 'user-1',
        repositoryId: 'asi-landing',
        title: 'Title',
        objective: 'Objective',
        instructions: oversized,
        idempotencyKey: 'dev-console-idem-total-limit',
      }),
    ).rejects.toMatchObject({ code: 'invalid_task_fields', status: 400 });
    expect(submitRuntimeBridgeTask).not.toHaveBeenCalled();
  });

  it('keeps the 2000-character per-line instruction limit', async () => {
    const { submitDevelopmentTask } = await import('../task-service');
    await expect(
      submitDevelopmentTask({
        ownerUserId: 'user-1',
        repositoryId: 'asi-landing',
        title: 'Title',
        objective: 'Objective',
        instructions: ['x'.repeat(2001)],
        idempotencyKey: 'dev-console-idem-line-limit',
      }),
    ).rejects.toMatchObject({ code: 'invalid_task_fields', status: 400 });
    expect(submitRuntimeBridgeTask).not.toHaveBeenCalled();
  });

  it('rejects modified content that reuses the same idempotency key', async () => {
    createCompatibleBridge();
    resolveAllowlistedBaselineSha.mockResolvedValue('f'.repeat(40));
    const { submitDevelopmentTask } = await import('../task-service');

    await submitDevelopmentTask({
      ownerUserId: 'user-1',
      repositoryId: 'asi-landing',
      title: 'Title',
      objective: 'Objective',
      instructions: 'Do the thing',
      idempotencyKey: 'dev-console-idem-conflict',
    });

    await expect(
      submitDevelopmentTask({
        ownerUserId: 'user-1',
        repositoryId: 'asi-landing',
        title: 'Different title',
        objective: 'Objective',
        instructions: 'Do the thing',
        idempotencyKey: 'dev-console-idem-conflict',
      }),
    ).rejects.toMatchObject({ code: 'idempotency_conflict', status: 409 });
    expect(submitRuntimeBridgeTask).toHaveBeenCalledTimes(1);
  });

  it('enforces Bridge equality of chatgptTaskId, conversationId and request hash on direct submit retries', async () => {
    createCompatibleBridge();
    resolveAllowlistedBaselineSha.mockResolvedValue('a'.repeat(40));
    findRuntimeBridgeTaskByIdempotencyKey.mockResolvedValue(null);

    const { submitDevelopmentTask } = await import('../task-service');
    const first = await submitDevelopmentTask({
      ownerUserId: 'user-1',
      repositoryId: 'asi-landing',
      title: 'Title',
      objective: 'Objective',
      instructions: ['step-1'],
      idempotencyKey: 'dev-console-idem-hash',
    });

    // Simulate a second process that skips local lookup but keeps deterministic ids.
    findRuntimeBridgeTaskByIdempotencyKey.mockResolvedValue(null);
    resolveAllowlistedBaselineSha.mockResolvedValue('a'.repeat(40));
    const second = await submitDevelopmentTask({
      ownerUserId: 'user-1',
      repositoryId: 'asi-landing',
      title: 'Title',
      objective: 'Objective',
      instructions: ['step-1'],
      idempotencyKey: 'dev-console-idem-hash',
    });

    expect(second.deduplicated).toBe(true);
    expect(second.snapshot.task.taskId).toBe(first.snapshot.task.taskId);
    expect(submitRuntimeBridgeTask).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = submitRuntimeBridgeTask.mock.calls.map((call) => call[1]);
    expect(firstCall.chatgptTaskId).toBe(secondCall.chatgptTaskId);
    expect(firstCall.conversationId).toBe(secondCall.conversationId);
    expect(runtimeBridgeRequestHash(firstCall.task)).toBe(runtimeBridgeRequestHash(secondCall.task));

    findRuntimeBridgeTaskByIdempotencyKey.mockResolvedValue(null);
    resolveAllowlistedBaselineSha.mockResolvedValue('b'.repeat(40));
    await expect(
      submitDevelopmentTask({
        ownerUserId: 'user-1',
        repositoryId: 'asi-landing',
        title: 'Title',
        objective: 'Objective',
        instructions: ['step-1'],
        idempotencyKey: 'dev-console-idem-hash',
      }),
    ).rejects.toMatchObject({ code: 'idempotency_conflict', status: 409 });
  });
});

describe('buildDevelopmentTaskSnapshot owner scope', () => {
  it('hides another allowlisted owner task as not found', async () => {
    const ownerA = 'owner-a';
    const ownerB = 'owner-b';
    const taskId = randomUUID();
    const bridge = createCompatibleBridge();
    bridge.seedTask({
      taskId,
      chatgptTaskId: chatgptTaskIdFor(ownerA, 'dev-console-idem-a'),
      conversationId: conversationIdFor(ownerA),
      status: 'queued',
      attemptCount: 0,
      createdAt: '2026-07-30T00:00:00.000Z',
      updatedAt: '2026-07-30T00:00:00.000Z',
      idempotencyKey: 'dev-console-idem-a',
      requestHash: 'a'.repeat(64),
      request: {
        title: 'Owned by A',
        objective: 'Secret objective',
        instructions: ['private'],
        repository: 'ASI-integration/asi-landing',
        baselineSha: 'c'.repeat(40),
      },
    });

    const { buildDevelopmentTaskSnapshot } = await import('../task-service');
    await expect(buildDevelopmentTaskSnapshot(taskId, ownerB)).rejects.toMatchObject({
      code: 'task_not_found',
      status: 404,
    });
    const own = await buildDevelopmentTaskSnapshot(taskId, ownerA);
    expect(own.task.taskId).toBe(taskId);
    expect(JSON.stringify(own)).not.toMatch(/ASI_DEVELOPMENT_OWNER_EMAILS|SERVICE_ROLE|TOKEN/i);
  });
});

describe('submitDevelopmentOwnerDecision', () => {
  const ownerA = 'owner-a';
  const ownerB = 'owner-b';
  const taskId = '11111111-1111-4111-8111-111111111111';
  const gateId = '22222222-2222-4222-8222-222222222222';

  function seedOwnedGate(status: DurableGate['status'] = 'pending', expiresAt = '2099-01-01T00:00:00.000Z') {
    const bridge = createCompatibleBridge();
    bridge.seedTask({
      taskId,
      chatgptTaskId: chatgptTaskIdFor(ownerA, 'dev-console-idem-gate'),
      conversationId: conversationIdFor(ownerA),
      status: status === 'pending' ? 'awaiting_owner' : status === 'approved' ? 'queued' : 'failed',
      attemptCount: 1,
      createdAt: '2026-07-30T00:00:00.000Z',
      updatedAt: '2026-07-30T00:01:00.000Z',
      idempotencyKey: 'dev-console-idem-gate',
      requestHash: 'b'.repeat(64),
      request: {
        title: 'Gate task',
        objective: 'Needs approval',
        instructions: ['review'],
        repository: 'ASI-integration/asi-landing',
        baselineSha: 'd'.repeat(40),
      },
    });
    const gate: DurableGate = {
      schemaVersion: 'asi.runtime.owner-gate.v1',
      action: 'create_pull_request',
      exactTarget: 'branch/feature',
      identity: 'runner',
      reason: 'needs approval',
      evidence: ['diff ready'],
      allowedSideEffect: 'open draft PR',
      rollback: 'close PR',
      postActionVerification: ['PR URL exists'],
      taskCycle: 'cycle-1',
      expiresAt,
      gateId,
      taskId,
      status,
      createdAt: '2026-07-30T00:00:00.000Z',
    };
    bridge.seedGate(gate);
    return { bridge, gate };
  }

  it('approves with server-forced source and deterministic decisionId', async () => {
    seedOwnedGate('pending');
    const { submitDevelopmentOwnerDecision } = await import('../task-service');
    const result = await submitDevelopmentOwnerDecision({
      ownerUserId: ownerA,
      taskId,
      gateId,
      taskCycle: 'cycle-1',
      decision: 'approved',
    });

    expect(submitRuntimeBridgeOwnerDecision).toHaveBeenCalledWith(
      'chatgpt-owner',
      expect.objectContaining({
        source: 'explicit_owner_message',
        decision: 'approved',
        decisionId: decisionIdFor({
          taskId,
          gateId,
          taskCycle: 'cycle-1',
          decision: 'approved',
        }),
      }),
    );
    expect(result.deduplicated).toBe(false);
    expect(result.snapshot.task.status).toBe('queued');
  });

  it('rejects a gate that belongs to another task', async () => {
    const bridge = seedOwnedGate('pending').bridge;
    const foreignTaskId = '33333333-3333-4333-8333-333333333333';
    bridge.seedTask({
      taskId: foreignTaskId,
      chatgptTaskId: chatgptTaskIdFor(ownerA, 'dev-console-idem-foreign'),
      conversationId: conversationIdFor(ownerA),
      status: 'awaiting_owner',
      attemptCount: 1,
      createdAt: '2026-07-30T00:00:00.000Z',
      updatedAt: '2026-07-30T00:01:00.000Z',
      idempotencyKey: 'dev-console-idem-foreign',
      requestHash: 'c'.repeat(64),
      request: {
        title: 'Foreign',
        objective: 'Other task',
        instructions: ['x'],
        repository: 'ASI-integration/asi-landing',
        baselineSha: 'e'.repeat(40),
      },
    });
    const { submitDevelopmentOwnerDecision } = await import('../task-service');
    await expect(
      submitDevelopmentOwnerDecision({
        ownerUserId: ownerA,
        taskId: foreignTaskId,
        gateId,
        taskCycle: 'cycle-1',
        decision: 'approved',
      }),
    ).rejects.toMatchObject({ code: 'owner_gate_mismatch' });
    expect(submitRuntimeBridgeOwnerDecision).not.toHaveBeenCalled();
  });

  it('rejects an expired pending gate before the Bridge RPC', async () => {
    seedOwnedGate('pending', '2000-01-01T00:00:00.000Z');
    const { submitDevelopmentOwnerDecision } = await import('../task-service');
    await expect(
      submitDevelopmentOwnerDecision({
        ownerUserId: ownerA,
        taskId,
        gateId,
        taskCycle: 'cycle-1',
        decision: 'rejected',
      }),
    ).rejects.toMatchObject({ code: 'owner_gate_expired' });
    expect(submitRuntimeBridgeOwnerDecision).not.toHaveBeenCalled();
  });

  it('supports pending → approved → exact duplicate retry through Bridge RPC', async () => {
    seedOwnedGate('pending');
    const { submitDevelopmentOwnerDecision } = await import('../task-service');

    const first = await submitDevelopmentOwnerDecision({
      ownerUserId: ownerA,
      taskId,
      gateId,
      taskCycle: 'cycle-1',
      decision: 'approved',
    });
    expect(first.deduplicated).toBe(false);
    expect(listRuntimeBridgeOwnerGates).not.toHaveBeenCalled();

    const second = await submitDevelopmentOwnerDecision({
      ownerUserId: ownerA,
      taskId,
      gateId,
      taskCycle: 'cycle-1',
      decision: 'approved',
    });
    expect(second.deduplicated).toBe(true);
    expect(submitRuntimeBridgeOwnerDecision).toHaveBeenCalledTimes(2);

    await expect(
      submitDevelopmentOwnerDecision({
        ownerUserId: ownerA,
        taskId,
        gateId,
        taskCycle: 'cycle-1',
        decision: 'rejected',
      }),
    ).rejects.toMatchObject({ code: 'decision_conflict', status: 409 });
  });

  it('supports pending → rejected → exact duplicate retry', async () => {
    seedOwnedGate('pending');
    const { submitDevelopmentOwnerDecision } = await import('../task-service');

    const first = await submitDevelopmentOwnerDecision({
      ownerUserId: ownerA,
      taskId,
      gateId,
      taskCycle: 'cycle-1',
      decision: 'rejected',
    });
    expect(first.deduplicated).toBe(false);
    expect(first.snapshot.task.status).toBe('failed');

    const second = await submitDevelopmentOwnerDecision({
      ownerUserId: ownerA,
      taskId,
      gateId,
      taskCycle: 'cycle-1',
      decision: 'rejected',
    });
    expect(second.deduplicated).toBe(true);
  });

  it('prevents owner B from reading or deciding owner A task/gate', async () => {
    seedOwnedGate('pending');
    const { buildDevelopmentTaskSnapshot, submitDevelopmentOwnerDecision } = await import('../task-service');

    await expect(buildDevelopmentTaskSnapshot(taskId, ownerB)).rejects.toMatchObject({
      code: 'task_not_found',
      status: 404,
    });
    await expect(
      submitDevelopmentOwnerDecision({
        ownerUserId: ownerB,
        taskId,
        gateId,
        taskCycle: 'cycle-1',
        decision: 'approved',
      }),
    ).rejects.toMatchObject({ code: 'task_not_found', status: 404 });
    expect(submitRuntimeBridgeOwnerDecision).not.toHaveBeenCalled();

    const allowed = await submitDevelopmentOwnerDecision({
      ownerUserId: ownerA,
      taskId,
      gateId,
      taskCycle: 'cycle-1',
      decision: 'approved',
    });
    expect(allowed.deduplicated).toBe(false);
    expect(JSON.stringify(allowed)).not.toMatch(/ASI_DEVELOPMENT_OWNER_EMAILS|owner@|SERVICE_ROLE|TOKEN/i);
  });
});
