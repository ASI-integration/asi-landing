import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const getSession = vi.fn();
const isSessionSecretConfigured = vi.fn(() => true);
const submitDevelopmentTask = vi.fn();
const buildDevelopmentTaskSnapshot = vi.fn();
const submitDevelopmentOwnerDecision = vi.fn();
const submitDevelopmentMergeRequest = vi.fn();
const getDevelopmentReadiness = vi.fn();

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
  submitDevelopmentMergeRequest,
}));

vi.mock('@/lib/development/readiness', () => ({
  getDevelopmentReadiness,
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
  submitDevelopmentMergeRequest.mockReset();
  getDevelopmentReadiness.mockReset();
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

describe('development console readiness API', () => {
  const readySnapshot = {
    schemaVersion: 'asi.owner-console.readiness.v1',
    overallState: 'ready',
    canLaunch: true,
    checkedAt: '2026-08-01T00:00:00.000Z',
    components: {
      bridge: { state: 'ready', reasonCode: 'bridge_ready', message: 'Bridge готов.', blockingLaunch: false },
      checkouts: { state: 'ready', reasonCode: 'runtime_checkouts_ready', message: 'Каталоги готовы.', blockingLaunch: false },
      baseline: { state: 'ready', reasonCode: 'baseline_ready', message: 'main готов.', blockingLaunch: false },
      executor: { state: 'ready', reasonCode: 'runtime_executor_ready', message: 'Исполнитель готов.', blockingLaunch: false },
      github: { state: 'ready', reasonCode: 'github_provider_ready', message: 'GitHub готов.', blockingLaunch: false },
    },
  };

  it('requires an owner session before running the bounded readiness check', async () => {
    getSession.mockResolvedValue({ userId: 'user-2', email: 'user@example.com' });
    const { GET } = await import('@/app/api/dashboard/development/readiness/route');
    const res = await GET();
    expect(res.status).toBe(403);
    expect(getDevelopmentReadiness).not.toHaveBeenCalled();
  });

  it('returns only the safe machine-readable readiness contract', async () => {
    getSession.mockResolvedValue(ownerSession());
    getDevelopmentReadiness.mockResolvedValue(readySnapshot);
    const { GET } = await import('@/app/api/dashboard/development/readiness/route');
    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(json).toEqual({ ok: true, readiness: readySnapshot });
    expect(JSON.stringify(json)).not.toMatch(/C:\\|\/srv\/|TOKEN|SERVICE_ROLE|stdout|stderr/i);
  });
});

describe('development readiness component behavior', () => {
  const checkoutJson = JSON.stringify([
    { id: 'runtime-primary', path: '/runtime/primary' },
    { id: 'runtime-secondary', path: '/runtime/secondary' },
  ]);
  const readyEnv = {
    ASI_RUNTIME_BRIDGE_CLIENT_ID: 'owner-console',
    ASI_RUNTIME_BRIDGE_SUPABASE_URL: 'https://bridge-isolated.example.com',
    ASI_RUNTIME_BRIDGE_SUPABASE_SERVICE_ROLE_KEY: 'not-returned-by-readiness',
    ASI_RUNTIME_BRIDGE_CHECKOUTS_JSON: checkoutJson,
  };
  const codedError = (code: string) => Object.assign(new Error(code), { code });

  async function actualReadiness(overrides: Record<string, unknown> = {}) {
    const actual = await vi.importActual<typeof import('@/lib/development/readiness')>(
      '@/lib/development/readiness',
    );
    return actual.getDevelopmentReadiness({
      env: readyEnv,
      now: () => new Date('2026-08-01T00:00:00.000Z'),
      probeBridgeStorage: async () => {},
      resolveBaselineSha: async () => 'a'.repeat(40),
      parseCheckouts: () => [
        { id: 'runtime-primary', path: '/runtime/primary' },
        { id: 'runtime-secondary', path: '/runtime/secondary' },
      ],
      inspectCheckouts: async () => ({ state: 'ready', reasonCode: 'runtime_checkouts_ready' }),
      inspectExecutor: async () => ({ ready: true, reasonCode: 'runtime_executor_ready' }),
      probeGitHub: async () => {},
      ...overrides,
    });
  }

  it.each([
    ['missing Bridge configuration', { env: { ...readyEnv, ASI_RUNTIME_BRIDGE_CLIENT_ID: '' } }, 'bridge', 'bridge_config_missing', false],
    ['invalid Bridge configuration', { env: { ...readyEnv, ASI_RUNTIME_BRIDGE_SUPABASE_URL: 'http://remote.example.com' } }, 'bridge', 'bridge_config_invalid', false],
    ['unreachable isolated Bridge storage', { probeBridgeStorage: async () => { throw codedError('offline'); } }, 'bridge', 'bridge_storage_unreachable', false],
    ['malformed checkout JSON', { parseCheckouts: () => { throw codedError('runtime_checkout_config_invalid'); } }, 'checkouts', 'runtime_checkout_config_invalid', false],
    ['missing checkout', { inspectCheckouts: async () => { throw codedError('runtime_checkout_missing'); } }, 'checkouts', 'runtime_checkout_missing', false],
    ['dirty checkout', { inspectCheckouts: async () => { throw codedError('runtime_checkout_dirty'); } }, 'checkouts', 'runtime_checkout_dirty', false],
    ['wrong origin', { inspectCheckouts: async () => { throw codedError('runtime_checkout_remote_mismatch'); } }, 'checkouts', 'runtime_checkout_remote_mismatch', false],
    ['recoverable baseline drift', { inspectCheckouts: async () => ({ state: 'degraded', reasonCode: 'runtime_checkout_recoverable_drift' }) }, 'checkouts', 'runtime_checkout_recoverable_drift', true],
    ['executor unavailable', { inspectExecutor: async () => ({ ready: false, reasonCode: 'runtime_executor_unavailable' }) }, 'executor', 'runtime_executor_unavailable', false],
    ['GitHub provider missing', { probeGitHub: async () => { throw codedError('github_provider_missing'); } }, 'github', 'github_provider_missing', true],
    ['GitHub provider unauthenticated', { probeGitHub: async () => { throw codedError('github_provider_unauthenticated'); } }, 'github', 'github_provider_unauthenticated', true],
  ] as const)('reports %s with a stable safe reason', async (_name, overrides, componentId, code, canLaunch) => {
    const readiness = await actualReadiness(overrides);
    expect(readiness.components[componentId].reasonCode).toBe(code);
    expect(readiness.canLaunch).toBe(canLaunch);
    expect(JSON.stringify(readiness)).not.toMatch(/\/runtime\/|not-returned-by-readiness/);
  });

  it('reports successful full readiness and retry is semantically idempotent', async () => {
    const first = await actualReadiness();
    const second = await actualReadiness();
    expect(first).toEqual(second);
    expect(first.overallState).toBe('ready');
    expect(first.canLaunch).toBe(true);
    expect(Object.values(first.components).every((item) => item.state === 'ready')).toBe(true);
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

describe('development console merge API', () => {
  it('returns the structured server blocker and cannot be bypassed by a direct request', async () => {
    getSession.mockResolvedValue(ownerSession());
    const currentSha = 'a'.repeat(40);
    submitDevelopmentMergeRequest.mockResolvedValue({
      merged: false,
      deduplicated: false,
      mergeCommitSha: null,
      gate: {
        gateState: 'pending',
        mergeState: 'blocked',
        repository: 'ASI-integration/asi-landing',
        pullRequestNumber: 123,
        pullRequestUrl: 'https://github.com/ASI-integration/asi-landing/pull/123',
        expectedSha: currentSha,
        currentSha,
        approvedSha: null,
        approvalTaskId: null,
        approvalSourceId: null,
        mergeRequestId: 'control-center-merge-stable',
        blocker: {
          code: 'owner_gate_pending',
          message: 'Ожидается решение владельца для текущей версии PR.',
          repository: 'ASI-integration/asi-landing',
          pullRequestNumber: 123,
          expectedSha: currentSha,
          currentSha,
          approvedSha: null,
          approvalTaskId: null,
        },
        merged: false,
        mergeCommitSha: null,
      },
    });

    const { POST } = await import('@/app/api/dashboard/development/tasks/[taskId]/merge/route');
    const res = await POST(new Request('http://localhost/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        pullRequestUrl: 'https://github.com/ASI-integration/asi-landing/pull/123',
        expectedHeadSha: currentSha,
        gateState: 'merge_allowed',
        approved: true,
      }),
    }), { params: { taskId: '11111111-1111-4111-8111-111111111111' } });
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json).toMatchObject({
      ok: false,
      merged: false,
      gate: { gateState: 'pending', mergeState: 'blocked' },
      blocker: { code: 'owner_gate_pending', expectedSha: currentSha, currentSha },
    });
    expect(submitDevelopmentMergeRequest).toHaveBeenCalledWith({
      ownerUserId: 'user-1',
      taskId: '11111111-1111-4111-8111-111111111111',
      pullRequestUrl: 'https://github.com/ASI-integration/asi-landing/pull/123',
      expectedHeadSha: currentSha,
    });
    expect(submitDevelopmentMergeRequest.mock.calls[0][0]).not.toHaveProperty('approved');
    expect(submitDevelopmentMergeRequest.mock.calls[0][0]).not.toHaveProperty('gateState');
  });
});

describe('owner console autonomous acceptance command', () => {
  it('uses one prompt and verifies a real draft PR contract without merge or deploy calls', async () => {
    const taskId = '11111111-1111-4111-8111-111111111111';
    const runId = '22222222-2222-4222-8222-222222222222';
    const headSha = 'a'.repeat(40);
    const draftPrUrl = 'https://github.com/ASI-integration/asi-landing/pull/130';
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let taskPolls = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/api/dashboard/development/readiness')) {
        return new Response(JSON.stringify({
          ok: true,
          readiness: {
            schemaVersion: 'asi.owner-console.readiness.v1',
            overallState: 'ready',
            canLaunch: true,
          },
        }), { status: 200 });
      }
      if (url.endsWith('/api/dashboard/development/tasks') && init?.method === 'POST') {
        return new Response(JSON.stringify({
          ok: true,
          taskId,
          task: { taskId, status: 'queued', attemptCount: 0 },
        }), { status: 200 });
      }
      if (url.endsWith(`/api/dashboard/development/tasks/${taskId}`)) {
        taskPolls += 1;
        return new Response(JSON.stringify({
          ok: true,
          task: { taskId, status: taskPolls === 1 ? 'running' : 'completed', attemptCount: 1 },
          result: taskPolls === 1 ? null : {
            status: 'completed',
            artifacts: [
              { type: 'commit', value: headSha },
              { type: 'pull_request', value: draftPrUrl },
            ],
          },
        }), { status: 200 });
      }
      if (url === 'https://api.github.com/repos/ASI-integration/asi-landing/pulls/130') {
        return new Response(JSON.stringify({
          draft: true,
          state: 'open',
          merged: false,
          head: { sha: headSha },
          base: { ref: 'main', repo: { full_name: 'ASI-integration/asi-landing' } },
        }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    });
    const acceptance = await import('../../../../../../scripts/owner-console-runtime-acceptance.mjs');
    const result = await acceptance.runOwnerConsoleRuntimeAcceptance({
      env: {
        ASI_OWNER_CONSOLE_ACCEPTANCE_CONFIRM: acceptance.OWNER_CONSOLE_RUNTIME_ACCEPTANCE_CONFIRM,
        ASI_OWNER_CONSOLE_ACCEPTANCE_BASE_URL: 'https://console.asi.example',
        ASI_OWNER_CONSOLE_ACCEPTANCE_SESSION_COOKIE: 'session-value-never-logged',
        GITHUB_TOKEN: 'github-value-never-logged',
      },
      fetchImpl,
      sleep: async () => {},
      createId: () => runId,
    });

    expect(result).toMatchObject({
      ok: true,
      marker: 'OWNER_CONSOLE_RUNTIME_FULL_AUTONOMOUS_E2E_READY',
      taskId,
      draftPrUrl,
      headSha,
      mergePerformed: false,
      deployPerformed: false,
    });
    const submitCall = calls.find((call) => call.url.endsWith('/api/dashboard/development/tasks'));
    const submittedBody = JSON.parse(String(submitCall?.init?.body));
    expect(Object.keys(submittedBody).sort()).toEqual(['idempotencyKey', 'prompt', 'repositoryId']);
    expect(submittedBody.prompt).toContain(`docs/operations/runtime-acceptance/${runId}.md`);
    expect(calls.some((call) => /\/merge|deploy/i.test(new URL(call.url).pathname))).toBe(false);
    expect(JSON.stringify(result)).not.toMatch(/session-value|github-value/);
  });
});
