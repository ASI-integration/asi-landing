import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { createPilotConversationId } from '@/lib/pilot/ids';

vi.mock('server-only', () => ({}));

const getSession = vi.fn();
const isSessionSecretConfigured = vi.fn(() => true);
const listPilotTasksForUser = vi.fn();
const getPilotTaskForUser = vi.fn();
const getPilotTaskDetailForUser = vi.fn();

class PilotAccessError extends Error {
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

vi.mock('@/lib/pilot/errors', () => ({
  PilotAccessError,
}));

const submitPilotTask = vi.fn();
const submitPilotOwnerDecision = vi.fn();
const getPilotReadiness = vi.fn();

vi.mock('@/lib/pilot/task-service', () => ({
  submitPilotTask,
  submitPilotOwnerDecision,
}));

vi.mock('@/lib/pilot/readiness', () => ({
  getPilotReadiness,
  assertPilotSubmissionReady: vi.fn(),
}));

vi.mock('@/lib/pilot/task-access', async () => {
  const actual = await vi.importActual<typeof import('@/lib/pilot/task-access')>(
    '@/lib/pilot/task-access',
  );
  return {
    ...actual,
    PilotAccessError,
    listPilotTasksForUser,
    getPilotTaskForUser,
    getPilotTaskDetailForUser,
  };
});

vi.mock('@/lib/pilot/access', async () => {
  const actual = await vi.importActual<typeof import('@/lib/pilot/access')>(
    '@/lib/pilot/access',
  );
  return actual;
});

function pilotSession() {
  return { userId: 'pilot-1', email: 'strigunov@example.com' };
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('ASI_PILOT_BETA_EMAILS', 'strigunov@example.com');
  vi.stubEnv('ASI_DEVELOPMENT_OWNER_EMAILS', 'owner@example.com');
  vi.stubEnv('SESSION_SECRET', 'x'.repeat(32));
  vi.resetModules();
  getSession.mockReset();
  isSessionSecretConfigured.mockReset();
  isSessionSecretConfigured.mockReturnValue(true);
  listPilotTasksForUser.mockReset();
  listPilotTasksForUser.mockResolvedValue([]);
  getPilotTaskForUser.mockReset();
  getPilotTaskDetailForUser.mockReset();
  submitPilotTask.mockReset();
  submitPilotOwnerDecision.mockReset();
  getPilotReadiness.mockReset();
  getPilotReadiness.mockResolvedValue({
    state: 'ready',
    canSubmit: true,
    messageRu: 'Готово к работе',
    checkedAt: '2026-09-08T00:00:00.000Z',
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('SP-02 pilot session API', () => {
  it('allows an invited pilot_beta session', async () => {
    getSession.mockResolvedValue(pilotSession());
    const { GET } = await import('@/app/api/pilot/session/route');
    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, role: 'pilot_beta', userId: 'pilot-1' });
    expect(JSON.stringify(json)).not.toMatch(/ASI_PILOT_BETA_EMAILS|strigunov@|SESSION_SECRET/i);
  });

  it('denies unauthenticated users', async () => {
    getSession.mockResolvedValue({ userId: '', email: '' });
    const { GET } = await import('@/app/api/pilot/session/route');
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('denies authenticated but uninvited users', async () => {
    getSession.mockResolvedValue({ userId: 'user-9', email: 'random@example.com' });
    const { GET } = await import('@/app/api/pilot/session/route');
    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(403);
    expect(json.ok).toBe(false);
  });
});

describe('SP-02 pilot vs owner surfaces', () => {
  it('denies pilot_beta on Owner Development Console tasks API', async () => {
    getSession.mockResolvedValue(pilotSession());
    const { GET } = await import('@/app/api/dashboard/development/tasks/route');
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('keeps owner email eligible for development console auth helper', async () => {
    const { isDevelopmentOwnerEmail } = await import('@/lib/development/access');
    const { isPilotBetaEmail } = await import('@/lib/pilot/access');
    expect(isDevelopmentOwnerEmail('owner@example.com')).toBe(true);
    expect(isPilotBetaEmail('owner@example.com')).toBe(false);
    expect(isDevelopmentOwnerEmail('strigunov@example.com')).toBe(false);
    expect(isPilotBetaEmail('strigunov@example.com')).toBe(true);
  });
});

describe('SP-02 pilot tasks API ownership', () => {
  it('lists tasks only for the authenticated pilot', async () => {
    getSession.mockResolvedValue(pilotSession());
    listPilotTasksForUser.mockResolvedValue([
      {
        taskId: randomUUID(),
        title: 'Mine',
        status: 'queued',
        repository: 'ASI-integration/asi-landing',
        createdAt: '2026-09-08T00:00:00.000Z',
        updatedAt: '2026-09-08T00:00:00.000Z',
      },
    ]);
    const { GET } = await import('@/app/api/pilot/tasks/route');
    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(listPilotTasksForUser).toHaveBeenCalledWith('pilot-1');
    expect(json.tasks).toHaveLength(1);
  });

  it('returns 404 when pilot requests another user task', async () => {
    getSession.mockResolvedValue(pilotSession());
    const foreignTaskId = randomUUID();
    getPilotTaskDetailForUser.mockRejectedValue(
      new PilotAccessError('task_not_found', 404, 'Задача не найдена.'),
    );
    const { GET } = await import('@/app/api/pilot/tasks/[taskId]/route');
    const res = await GET(new Request(`http://localhost/api/pilot/tasks/${foreignTaskId}`), {
      params: { taskId: foreignTaskId },
    });
    const json = await res.json();
    expect(res.status).toBe(404);
    expect(json.code).toBe('task_not_found');
    expect(getPilotTaskDetailForUser).toHaveBeenCalledWith(foreignTaskId, 'pilot-1');
  });

  it('returns the task when ownership matches', async () => {
    getSession.mockResolvedValue(pilotSession());
    const taskId = randomUUID();
    getPilotTaskDetailForUser.mockResolvedValue({
      task: {
        taskId,
        title: 'Owned',
        status: 'queued',
        consoleStatus: 'queued',
        repository: 'ASI-integration/asi-landing',
        conversationId: createPilotConversationId('pilot-1'),
        createdAt: '2026-09-08T00:00:00.000Z',
        updatedAt: '2026-09-08T00:00:00.000Z',
      },
      result: {
        outcome: null,
        summary: null,
        changedFiles: [],
        pullRequestUrl: null,
        commitSha: null,
        blockers: [],
      },
      hitl: null,
    });
    const { GET } = await import('@/app/api/pilot/tasks/[taskId]/route');
    const res = await GET(new Request(`http://localhost/api/pilot/tasks/${taskId}`), {
      params: { taskId },
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.task.taskId).toBe(taskId);
    expect(json.task.title).toBe('Owned');
    expect(json.task.consoleStatus).toBe('queued');
    expect(json.result).toEqual({
      outcome: null,
      summary: null,
      changedFiles: [],
      pullRequestUrl: null,
      commitSha: null,
      blockers: [],
    });
    expect(JSON.stringify(json)).not.toMatch(/ASI_PILOT_BETA_EMAILS|SERVICE_ROLE|TOKEN/i);
  });
});

describe('SP-04 Pilot Console API contract', () => {
  it('returns normalized consoleStatus and safe result for a completed task', async () => {
    getSession.mockResolvedValue(pilotSession());
    const taskId = randomUUID();
    getPilotTaskDetailForUser.mockResolvedValue({
      task: {
        taskId,
        title: 'Done',
        status: 'completed',
        consoleStatus: 'succeeded',
        repository: 'ASI-integration/asi-landing',
        conversationId: createPilotConversationId('pilot-1'),
        createdAt: '2026-09-08T00:00:00.000Z',
        updatedAt: '2026-09-08T01:00:00.000Z',
      },
      result: {
        outcome: 'succeeded',
        summary: 'Proof doc added',
        changedFiles: ['docs/pilot/proof.md'],
        pullRequestUrl: 'https://github.com/ASI-integration/asi-landing/pull/1',
        commitSha: 'a'.repeat(40),
        blockers: [],
      },
      hitl: null,
    });
    const { GET } = await import('@/app/api/pilot/tasks/[taskId]/route');
    const res = await GET(new Request(`http://localhost/api/pilot/tasks/${taskId}`), {
      params: { taskId },
    });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.task.consoleStatus).toBe('succeeded');
    expect(json.result.outcome).toBe('succeeded');
    expect(json.result.changedFiles).toEqual(['docs/pilot/proof.md']);
    expect(JSON.stringify(json)).not.toMatch(/schemaVersion|leaseToken|SERVICE_ROLE|provider/i);
    expect(json.hitl).toBeNull();
  });

  it('owner HITL continue returns the same taskId', async () => {
    getSession.mockResolvedValue(pilotSession());
    const taskId = randomUUID();
    submitPilotOwnerDecision.mockResolvedValue({
      deduplicated: false,
      hitl: null,
      task: {
        taskId,
        title: 'Same task',
        status: 'queued',
        consoleStatus: 'queued',
        repository: 'ASI-integration/asi-landing',
        conversationId: createPilotConversationId('pilot-1'),
        createdAt: '2026-09-08T00:00:00.000Z',
        updatedAt: '2026-09-08T00:05:00.000Z',
      },
      result: {
        outcome: null,
        summary: null,
        changedFiles: [],
        pullRequestUrl: null,
        commitSha: null,
        blockers: [],
      },
    });
    const { POST } = await import('@/app/api/pilot/tasks/[taskId]/route');
    const res = await POST(new Request(`http://localhost/api/pilot/tasks/${taskId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        decision: 'continue',
        gateId: randomUUID(),
        taskCycle: 'cycle-1',
      }),
    }), { params: { taskId } });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.taskId).toBe(taskId);
    expect(json.task.taskId).toBe(taskId);
    expect(json.task.consoleStatus).toBe('queued');
    expect(submitPilotOwnerDecision).toHaveBeenCalledWith({
      pilotUserId: 'pilot-1',
      taskId,
      body: expect.objectContaining({ decision: 'continue' }),
    });
    expect(submitPilotTask).not.toHaveBeenCalled();
  });

  it('maps create response consoleStatus for Pilot Console', async () => {
    getSession.mockResolvedValue(pilotSession());
    const taskId = randomUUID();
    submitPilotTask.mockResolvedValue({
      deduplicated: false,
      template: { templateId: 'strigunov_pilot_green_v1' },
      task: {
        taskId,
        title: 'Pilot proof',
        status: 'queued',
        consoleStatus: 'queued',
        repository: 'ASI-integration/asi-landing',
        createdAt: '2026-09-08T00:00:00.000Z',
        updatedAt: '2026-09-08T00:00:00.000Z',
      },
    });
    const { POST } = await import('@/app/api/pilot/tasks/route');
    const res = await POST(new Request('http://localhost/api/pilot/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        goal: 'Add a proof markdown under docs/pilot/.',
        idempotencyKey: 'pilot-beta-idem-sp04',
      }),
    }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.task.consoleStatus).toBe('queued');
  });
});

describe('SP-02 conversation id helper sanity', () => {
  it('builds stable pilot conversation ids', () => {
    const a = createPilotConversationId('pilot-1');
    const again = createPilotConversationId('pilot-1');
    const digest = createHash('sha256').update('pilot_beta|pilot-1', 'utf8').digest('hex').slice(0, 24);
    expect(a).toBe(again);
    expect(a).toBe(`pilot-beta-${digest}`);
  });
});

describe('SP-02 — POST /api/pilot/tasks green create', () => {
  it('allows invited pilot_beta to create a valid green-path task', async () => {
    getSession.mockResolvedValue(pilotSession());
    const taskId = randomUUID();
    submitPilotTask.mockResolvedValue({
      deduplicated: false,
      template: { templateId: 'strigunov_pilot_green_v1' },
      task: {
        taskId,
        title: 'Pilot proof',
        status: 'queued',
        repository: 'ASI-integration/asi-landing',
        createdAt: '2026-09-08T00:00:00.000Z',
        updatedAt: '2026-09-08T00:00:00.000Z',
      },
    });
    const { POST } = await import('@/app/api/pilot/tasks/route');
    const res = await POST(new Request('http://localhost/api/pilot/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        goal: 'Add a proof markdown under docs/pilot/.',
        idempotencyKey: 'pilot-beta-idem-route-1',
      }),
    }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.taskId).toBe(taskId);
    expect(json.templateId).toBe('strigunov_pilot_green_v1');
    expect(submitPilotTask).toHaveBeenCalledWith({
      pilotUserId: 'pilot-1',
      body: expect.objectContaining({
        goal: 'Add a proof markdown under docs/pilot/.',
        idempotencyKey: 'pilot-beta-idem-route-1',
      }),
    });
  });

  it('denies unauthenticated create', async () => {
    getSession.mockResolvedValue({ userId: '', email: '' });
    const { POST } = await import('@/app/api/pilot/tasks/route');
    const res = await POST(new Request('http://localhost/api/pilot/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal: 'docs', idempotencyKey: 'pilot-beta-idem-x' }),
    }));
    expect(res.status).toBe(401);
    expect(submitPilotTask).not.toHaveBeenCalled();
  });

  it('denies authenticated uninvited create', async () => {
    getSession.mockResolvedValue({ userId: 'u-9', email: 'random@example.com' });
    const { POST } = await import('@/app/api/pilot/tasks/route');
    const res = await POST(new Request('http://localhost/api/pilot/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ goal: 'docs', idempotencyKey: 'pilot-beta-idem-x' }),
    }));
    expect(res.status).toBe(403);
    expect(submitPilotTask).not.toHaveBeenCalled();
  });

  it('returns 400 when template rejects privileged fields', async () => {
    getSession.mockResolvedValue(pilotSession());
    submitPilotTask.mockRejectedValue(
      new PilotAccessError('privileged_field_forbidden', 400, 'Поле задаётся только сервером и не принимается от клиента.'),
    );
    const { POST } = await import('@/app/api/pilot/tasks/route');
    const res = await POST(new Request('http://localhost/api/pilot/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        goal: 'Add docs under docs/pilot/.',
        idempotencyKey: 'pilot-beta-idem-priv',
        baselineSha: 'c'.repeat(40),
      }),
    }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.code).toBe('privileged_field_forbidden');
  });

  it('returns 503 when readiness blocks create (no fake success)', async () => {
    getSession.mockResolvedValue(pilotSession());
    submitPilotTask.mockRejectedValue(
      new PilotAccessError(
        'readiness_blocked',
        503,
        'Временно недоступно',
      ),
    );
    const { POST } = await import('@/app/api/pilot/tasks/route');
    const res = await POST(new Request('http://localhost/api/pilot/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        goal: 'Add a proof markdown under docs/pilot/.',
        idempotencyKey: 'pilot-beta-idem-not-ready',
      }),
    }));
    const json = await res.json();
    expect(res.status).toBe(503);
    expect(json.ok).toBe(false);
    expect(json.code).toBe('readiness_blocked');
    expect(json.taskId).toBeUndefined();
  });

  it('returns 503 Временно недоступно when admission is busy', async () => {
    getSession.mockResolvedValue(pilotSession());
    submitPilotTask.mockRejectedValue(
      new PilotAccessError(
        'admission_busy',
        503,
        'Временно недоступно',
      ),
    );
    const { POST } = await import('@/app/api/pilot/tasks/route');
    const res = await POST(new Request('http://localhost/api/pilot/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        goal: 'Add a proof markdown under docs/pilot/.',
        idempotencyKey: 'pilot-beta-idem-admission-busy',
      }),
    }));
    const json = await res.json();
    expect(res.status).toBe(503);
    expect(json).toEqual({
      ok: false,
      code: 'admission_busy',
      message: 'Временно недоступно',
    });
    expect(JSON.stringify(json)).not.toMatch(/runtime|bridge|runner|lease|lane|executor/i);
  });
});

describe('SP-08 GET /api/pilot/readiness', () => {
  it('returns safe readiness for invited pilot_beta', async () => {
    getSession.mockResolvedValue(pilotSession());
    const { GET } = await import('@/app/api/pilot/readiness/route');
    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({
      ok: true,
      readiness: {
        state: 'ready',
        canSubmit: true,
        messageRu: 'Готово к работе',
        checkedAt: '2026-09-08T00:00:00.000Z',
      },
    });
    expect(JSON.stringify(json)).not.toMatch(/runnerId|components|SERVICE_ROLE|\/opt\//i);
  });

  it('denies unauthenticated readiness', async () => {
    getSession.mockResolvedValue({ userId: '', email: '' });
    const { GET } = await import('@/app/api/pilot/readiness/route');
    const res = await GET();
    expect(res.status).toBe(401);
    expect(getPilotReadiness).not.toHaveBeenCalled();
  });

  it('denies uninvited readiness', async () => {
    getSession.mockResolvedValue({ userId: 'u-9', email: 'random@example.com' });
    const { GET } = await import('@/app/api/pilot/readiness/route');
    const res = await GET();
    expect(res.status).toBe(403);
    expect(getPilotReadiness).not.toHaveBeenCalled();
  });
});
