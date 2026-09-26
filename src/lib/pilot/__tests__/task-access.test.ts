import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeBridgeTaskRequest } from '@/lib/asi-runtime/bridge-types';
import { createPilotConversationId } from '../ids';

vi.mock('server-only', () => ({}));

const getRuntimeBridgeClientId = vi.fn(() => 'pilot-client');
const getRuntimeBridgeTaskRecord = vi.fn();
const getRuntimeBridgeResult = vi.fn();
const listRuntimeBridgeTasks = vi.fn();
const listRuntimeBridgeOwnerGates = vi.fn();
const isRuntimeBridgeSupabaseConfigured = vi.fn(() => true);

vi.mock('@/lib/asi-runtime/bridge-auth', () => ({
  getRuntimeBridgeClientId,
}));

vi.mock('@/lib/asi-runtime/bridge-supabase', () => ({
  isRuntimeBridgeSupabaseConfigured,
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
  getRuntimeBridgeTaskRecord,
  getRuntimeBridgeResult,
  listRuntimeBridgeTasks,
  listRuntimeBridgeOwnerGates,
}));

function seedRecord(ownerUserId: string, overrides: {
  taskId?: string;
  conversationId?: string;
  title?: string;
  repository?: RuntimeBridgeTaskRequest['repository'];
} = {}) {
  const request: RuntimeBridgeTaskRequest = {
    title: overrides.title ?? 'Pilot task',
    objective: 'Objective',
    instructions: ['step'],
    repository: overrides.repository ?? 'ASI-integration/asi-landing',
    baselineSha: 'c'.repeat(40),
  };
  return {
    taskId: overrides.taskId ?? randomUUID(),
    chatgptTaskId: `pilot-beta-task-${createHash('sha256').update(ownerUserId).digest('hex').slice(0, 8)}`,
    conversationId: overrides.conversationId ?? createPilotConversationId(ownerUserId),
    status: 'queued' as const,
    attemptCount: 0,
    createdAt: '2026-09-08T00:00:00.000Z',
    updatedAt: '2026-09-08T00:00:00.000Z',
    idempotencyKey: 'pilot-beta-idem-x',
    requestHash: 'a'.repeat(64),
    request,
  };
}

beforeEach(() => {
  vi.resetModules();
  getRuntimeBridgeClientId.mockReset();
  getRuntimeBridgeClientId.mockReturnValue('pilot-client');
  getRuntimeBridgeTaskRecord.mockReset();
  getRuntimeBridgeResult.mockReset();
  listRuntimeBridgeTasks.mockReset();
  listRuntimeBridgeOwnerGates.mockReset();
  listRuntimeBridgeOwnerGates.mockResolvedValue([]);
  isRuntimeBridgeSupabaseConfigured.mockReset();
  isRuntimeBridgeSupabaseConfigured.mockReturnValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('SP-02 pilot task ownership', () => {
  it('allows the owning pilot to read their task', async () => {
    const task = seedRecord('pilot-a');
    getRuntimeBridgeTaskRecord.mockResolvedValue(task);
    const { getPilotTaskForUser } = await import('../task-access');
    const got = await getPilotTaskForUser(task.taskId, 'pilot-a');
    expect(got.taskId).toBe(task.taskId);
    expect(got.title).toBe('Pilot task');
    expect(got.consoleStatus).toBe('queued');
  });

  it('hides another pilot user task as not found', async () => {
    const task = seedRecord('pilot-a', { title: 'Secret A' });
    getRuntimeBridgeTaskRecord.mockResolvedValue(task);
    const { getPilotTaskForUser, PilotAccessError } = await import('../task-access');
    await expect(getPilotTaskForUser(task.taskId, 'pilot-b')).rejects.toMatchObject({
      code: 'task_not_found',
      status: 404,
    });
    await expect(getPilotTaskForUser(task.taskId, 'pilot-b')).rejects.toBeInstanceOf(PilotAccessError);
  });

  it('does not treat owner-console conversation tasks as pilot-owned', async () => {
    const digest = createHash('sha256').update('pilot-a', 'utf8').digest('hex').slice(0, 24);
    const ownerConversationTask = seedRecord('pilot-a', {
      conversationId: `dev-console-owner-${digest}`,
      title: 'Owner console task',
    });
    getRuntimeBridgeTaskRecord.mockResolvedValue(ownerConversationTask);
    const { getPilotTaskForUser } = await import('../task-access');
    await expect(getPilotTaskForUser(ownerConversationTask.taskId, 'pilot-a')).rejects.toMatchObject({
      code: 'task_not_found',
      status: 404,
    });
  });

  it('lists only the requesting pilot conversation', async () => {
    const expectedConversation = createPilotConversationId('pilot-a');
    listRuntimeBridgeTasks.mockResolvedValue([
      {
        ...seedRecord('pilot-a'),
        title: 'Pilot task',
        repository: 'ASI-integration/asi-landing',
      },
    ]);
    const { listPilotTasksForUser } = await import('../task-access');
    const tasks = await listPilotTasksForUser('pilot-a');
    expect(listRuntimeBridgeTasks).toHaveBeenCalledWith('pilot-client', expectedConversation, undefined);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Pilot task');
    expect(tasks[0].consoleStatus).toBe('queued');
  });
});

describe('SP-04 getPilotTaskDetailForUser', () => {
  it('returns normalized status and safe result for completed owned tasks', async () => {
    const task = { ...seedRecord('pilot-a'), status: 'completed' as const };
    getRuntimeBridgeTaskRecord.mockResolvedValue(task);
    getRuntimeBridgeResult.mockResolvedValue({
      taskId: task.taskId,
      status: 'completed',
      result: {
        schemaVersion: 'asi.runtime.result.v1',
        status: 'completed',
        summary: 'Done',
        changedFiles: ['docs/pilot/a.md'],
        checks: [{ name: 'x', status: 'PASS' }],
        artifacts: [{ type: 'commit', value: 'd'.repeat(40) }],
        blockers: [],
      },
    });
    const { getPilotTaskDetailForUser } = await import('../task-access');
    const detail = await getPilotTaskDetailForUser(task.taskId, 'pilot-a');
    expect(detail.task.consoleStatus).toBe('succeeded');
    expect(detail.result.outcome).toBe('succeeded');
    expect(detail.result.summary).toBe('Done');
    expect(detail.result.commitSha).toBe('d'.repeat(40));
    expect(JSON.stringify(detail)).not.toMatch(/schemaVersion|checks/);
    expect(getRuntimeBridgeResult).toHaveBeenCalledWith('pilot-client', task.taskId);
  });

  it('does not fetch result for non-terminal tasks', async () => {
    const task = seedRecord('pilot-a');
    getRuntimeBridgeTaskRecord.mockResolvedValue(task);
    const { getPilotTaskDetailForUser } = await import('../task-access');
    const detail = await getPilotTaskDetailForUser(task.taskId, 'pilot-a');
    expect(detail.task.consoleStatus).toBe('queued');
    expect(detail.result.outcome).toBeNull();
    expect(getRuntimeBridgeResult).not.toHaveBeenCalled();
  });

  it('hides foreign task detail as not found', async () => {
    const task = seedRecord('pilot-a');
    getRuntimeBridgeTaskRecord.mockResolvedValue(task);
    const { getPilotTaskDetailForUser } = await import('../task-access');
    await expect(getPilotTaskDetailForUser(task.taskId, 'pilot-b')).rejects.toMatchObject({
      code: 'task_not_found',
      status: 404,
    });
    expect(getRuntimeBridgeResult).not.toHaveBeenCalled();
  });
});
