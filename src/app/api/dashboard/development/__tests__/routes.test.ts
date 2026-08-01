import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const getSession = vi.fn();
const isSessionSecretConfigured = vi.fn(() => true);
const submitDevelopmentTask = vi.fn();
const buildDevelopmentTaskSnapshot = vi.fn();
const submitDevelopmentOwnerDecision = vi.fn();

class DevelopmentConsoleError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly messageRu: string,
  ) {
    super(code);
  }
}

vi.mock('@/lib/auth', () => ({
  getSession,
  isSessionSecretConfigured,
}));

vi.mock('@/lib/development/task-service', () => ({
  DevelopmentConsoleError,
  submitDevelopmentTask,
  buildDevelopmentTaskSnapshot,
  submitDevelopmentOwnerDecision,
}));

vi.mock('@/lib/development/access', async () => {
  const actual = await vi.importActual<typeof import('@/lib/development/access')>(
    '@/lib/development/access',
  );
  return actual;
});

function ownerSession() {
  return { userId: 'user-1', email: 'owner@example.com' };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('ASI_DEVELOPMENT_OWNER_EMAILS', 'owner@example.com');
  vi.stubEnv('SESSION_SECRET', 'x'.repeat(32));
  vi.resetModules();
  getSession.mockReset();
  isSessionSecretConfigured.mockReset();
  isSessionSecretConfigured.mockReturnValue(true);
  submitDevelopmentTask.mockReset();
  buildDevelopmentTaskSnapshot.mockReset();
  submitDevelopmentOwnerDecision.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('development console API access', () => {
  it('denies a regular user on POST /tasks', async () => {
    getSession.mockResolvedValue({ userId: 'user-2', email: 'user@example.com' });
    const { POST } = await import('@/app/api/dashboard/development/tasks/route');
    const res = await POST(
      new Request('http://localhost/api/dashboard/development/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          repositoryId: 'asi-landing',
          title: 'T',
          objective: 'O',
          instructions: 'do it',
        }),
      }),
    );
    expect(res.status).toBe(403);
    expect(submitDevelopmentTask).not.toHaveBeenCalled();
  });

  it('denies CRM operator without owner allowlist membership', async () => {
    vi.stubEnv('ASI_DEVELOPMENT_OWNER_EMAILS', 'owner@example.com');
    vi.stubEnv('CRM_OPERATOR_EMAILS', 'crm@asi-global.ru');
    getSession.mockResolvedValue({ userId: 'crm-1', email: 'crm@asi-global.ru' });
    const { GET } = await import('@/app/api/dashboard/development/tasks/[taskId]/route');
    const res = await GET(new Request('http://localhost/api/dashboard/development/tasks/x'), {
      params: { taskId: '11111111-1111-4111-8111-111111111111' },
    });
    expect(res.status).toBe(403);
    expect(buildDevelopmentTaskSnapshot).not.toHaveBeenCalled();
  });
});

describe('development console task submit API', () => {
  it('submits one required natural-language prompt without advanced fields', async () => {
    getSession.mockResolvedValue(ownerSession());
    submitDevelopmentTask.mockResolvedValue({
      deduplicated: false,
      snapshot: {
        task: {
          taskId: '11111111-1111-4111-8111-111111111111',
          chatgptTaskId: 'dev-console-task-1',
          conversationId: 'dev-console-owner-1',
          status: 'queued',
          attemptCount: 0,
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
          repository: 'ASI-integration/asi-landing',
        },
        result: null,
        pendingGates: [],
      },
    });

    const { POST } = await import('@/app/api/dashboard/development/tasks/route');
    const res = await POST(new Request('http://localhost/api/dashboard/development/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        repositoryId: 'asi-landing',
        prompt: 'Исправь ошибку, из-за которой задача падает при рассинхроне baseline.',
        idempotencyKey: 'dev-console-idem-single-prompt',
      }),
    }));

    expect(res.status).toBe(200);
    expect(submitDevelopmentTask).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'Исправь ошибку, из-за которой задача падает при рассинхроне baseline.',
      title: undefined,
      objective: undefined,
      instructions: undefined,
    }));
  });

  it('submits through the service and never returns credentials', async () => {
    getSession.mockResolvedValue(ownerSession());
    submitDevelopmentTask.mockResolvedValue({
      deduplicated: false,
      snapshot: {
        task: {
          taskId: '11111111-1111-4111-8111-111111111111',
          chatgptTaskId: 'dev-console-task-1',
          conversationId: 'dev-console-owner-1',
          status: 'queued',
          attemptCount: 0,
          createdAt: '2026-07-30T00:00:00.000Z',
          updatedAt: '2026-07-30T00:00:00.000Z',
          repository: 'ASI-integration/asi-landing',
        },
        result: null,
        pendingGates: [],
      },
    });

    const { POST } = await import('@/app/api/dashboard/development/tasks/route');
    const res = await POST(
      new Request('http://localhost/api/dashboard/development/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          repositoryId: 'asi-landing',
          title: 'Add console',
          objective: 'Ship owner console',
          instructions: 'Reuse Runtime Bridge',
          idempotencyKey: 'dev-console-idem-1',
        }),
      }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.taskId).toBe('11111111-1111-4111-8111-111111111111');
    expect(JSON.stringify(json)).not.toMatch(/ASI_RUNTIME_BRIDGE|SUPABASE_SERVICE_ROLE|CHAT_TOKEN|OWNER_TOKEN/i);
    expect(submitDevelopmentTask).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: 'user-1',
        repositoryId: 'asi-landing',
        idempotencyKey: 'dev-console-idem-1',
      }),
    );
  });
});

describe('development console repository preference', () => {
  it('uses an allowlisted remembered repository and safely falls back', async () => {
    const repositories = await import('@/lib/development/repositories');
    const options = repositories.listDevelopmentRepositories();

    expect(repositories.resolveRememberedDevelopmentRepositoryId(options, 'asi-landing'))
      .toBe('asi-landing');
    expect(repositories.resolveRememberedDevelopmentRepositoryId(options, 'forged-repository'))
      .toBe(options[0].id);
  });
});

describe('development console task read API', () => {
  const taskBase = {
    taskId: '11111111-1111-4111-8111-111111111111',
    chatgptTaskId: 'dev-console-task-1',
    conversationId: 'dev-console-owner-1',
    attemptCount: 1,
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:01:00.000Z',
    repository: 'ASI-integration/asi-landing',
  };

  it.each([
    ['queued', { result: null, pendingGates: [] }],
    ['running', { result: null, pendingGates: [] }],
    [
      'awaiting_owner',
      {
        result: null,
        pendingGates: [
          {
            schemaVersion: 'asi.runtime.owner-gate.v1',
            action: 'create_pull_request',
            exactTarget: 'branch/feature',
            identity: 'owner',
            reason: 'needs approval',
            evidence: ['diff'],
            allowedSideEffect: 'open PR',
            rollback: 'close PR',
            postActionVerification: ['pr exists'],
            taskCycle: 'cycle-1',
            expiresAt: '2099-01-01T00:00:00.000Z',
            gateId: '22222222-2222-4222-8222-222222222222',
            taskId: '11111111-1111-4111-8111-111111111111',
            status: 'pending',
            createdAt: '2026-07-30T00:00:00.000Z',
          },
        ],
      },
    ],
    [
      'completed',
      {
        result: {
          schemaVersion: 'asi.runtime.result.v1',
          status: 'completed',
          summary: 'done',
          changedFiles: ['src/a.ts'],
          checks: [{ name: 'typecheck', status: 'PASS' }],
          artifacts: [{ type: 'pull_request', value: 'https://github.com/ASI-integration/asi-landing/pull/1' }],
          blockers: [],
        },
        pendingGates: [],
      },
    ],
    [
      'failed',
      {
        result: {
          schemaVersion: 'asi.runtime.result.v1',
          status: 'failed',
          summary: 'failed',
          changedFiles: [],
          checks: [],
          artifacts: [],
          blockers: ['blocked'],
        },
        pendingGates: [],
      },
    ],
  ] as const)('returns %s snapshot', async (status, extras) => {
    getSession.mockResolvedValue(ownerSession());
    buildDevelopmentTaskSnapshot.mockResolvedValue({
      task: { ...taskBase, status },
      ...extras,
    });
    const { GET } = await import('@/app/api/dashboard/development/tasks/[taskId]/route');
    const res = await GET(new Request('http://localhost/x'), {
      params: { taskId: taskBase.taskId },
    });
    expect(res.headers.get('cache-control')).toBe('no-store');
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.task.status).toBe(status);
    expect(json.result ?? null).toEqual(extras.result);
    expect(json.pendingGates).toEqual(extras.pendingGates);
    expect(buildDevelopmentTaskSnapshot).toHaveBeenCalledWith(taskBase.taskId, 'user-1');
    expect(JSON.stringify(json)).not.toMatch(/stdout|stderr|leaseToken|SERVICE_ROLE/i);
  });

  it('maps missing task from another client scope to a safe error', async () => {
    getSession.mockResolvedValue(ownerSession());
    buildDevelopmentTaskSnapshot.mockRejectedValue(
      new DevelopmentConsoleError('task_not_found', 404, 'Задача не найдена.'),
    );
    const { GET } = await import('@/app/api/dashboard/development/tasks/[taskId]/route');
    const res = await GET(new Request('http://localhost/x'), {
      params: { taskId: '99999999-9999-4999-8999-999999999999' },
    });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.message).toBe('Задача не найдена.');
    expect(json.stack).toBeUndefined();
  });
});

describe('development console owner decision API', () => {
  it('approves through the server-owned decision path and ignores client source', async () => {
    getSession.mockResolvedValue(ownerSession());
    submitDevelopmentOwnerDecision.mockResolvedValue({
      deduplicated: false,
      snapshot: {
        task: {
          taskId: '11111111-1111-4111-8111-111111111111',
          chatgptTaskId: 'dev-console-task-1',
          conversationId: 'dev-console-owner-1',
          status: 'queued',
          attemptCount: 1,
          createdAt: '2026-07-30T00:00:00.000Z',
          updatedAt: '2026-07-30T00:02:00.000Z',
          repository: 'ASI-integration/asi-landing',
        },
        result: null,
        pendingGates: [],
      },
    });

    const { POST } = await import('@/app/api/dashboard/development/tasks/[taskId]/decisions/route');
    const res = await POST(
      new Request('http://localhost/x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          gateId: '22222222-2222-4222-8222-222222222222',
          taskCycle: 'cycle-1',
          decision: 'approved',
          source: 'forged_client_source',
        }),
      }),
      { params: { taskId: '11111111-1111-4111-8111-111111111111' } },
    );
    expect(res.status).toBe(200);
    expect(submitDevelopmentOwnerDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: 'user-1',
        decision: 'approved',
        gateId: '22222222-2222-4222-8222-222222222222',
      }),
    );
    expect(submitDevelopmentOwnerDecision.mock.calls[0][0]).not.toHaveProperty('source');
  });
});
