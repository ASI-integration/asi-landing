import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const upsertRuntimeSnapshot = vi.fn();
const getRuntimeSnapshotForUser = vi.fn();
const getSession = vi.fn();
const isSessionSecretConfigured = vi.fn(() => true);

vi.mock('@/lib/asi-runtime/repository', () => ({
  upsertRuntimeSnapshot,
  getRuntimeSnapshotForUser,
}));

vi.mock('@/lib/auth', () => ({
  getSession,
  isSessionSecretConfigured,
}));

const INGEST_TOKEN = 'runtime-ingest-token-test';
const OWNER_USER_ID = 'owner-user-uuid';

const validPayload = {
  taskId: 'task-42',
  taskTitle: 'Добавить runtime snapshot',
  status: 'running',
  currentStage: 'verify',
  completedSteps: 2,
  totalSteps: 5,
  progressPercent: 40,
  provider: 'cursor',
  attemptNumber: 1,
  commitSha: 'abc1234',
  pullRequestUrl: 'https://github.com/example/repo/pull/7',
  verificationStatus: 'pending',
  lastEvent: 'tests_passed',
  startedAt: '2026-07-20T09:00:00.000Z',
  payloadVersion: 1,
};

const storedRow = {
  user_id: OWNER_USER_ID,
  task_id: 'task-42',
  task_title: 'Добавить runtime snapshot',
  status: 'running',
  current_stage: 'verify',
  completed_steps: 2,
  total_steps: 5,
  progress_percent: 40,
  provider: 'cursor',
  attempt_number: 1,
  commit_sha: 'abc1234',
  pull_request_url: 'https://github.com/example/repo/pull/7',
  verification_status: 'pending',
  last_event: 'tests_passed',
  started_at: '2026-07-20T09:00:00.000Z',
  updated_at: '2026-07-20T11:00:00.000Z',
  payload_version: 1,
};

function postRequest(body: unknown, token?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  return new Request('http://localhost/api/internal/asi-runtime/snapshot', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetModules();
  upsertRuntimeSnapshot.mockReset();
  getRuntimeSnapshotForUser.mockReset();
  getSession.mockReset();
  isSessionSecretConfigured.mockReturnValue(true);
  process.env.ASI_RUNTIME_INGEST_TOKEN = INGEST_TOKEN;
  process.env.ASI_RUNTIME_OWNER_USER_ID = OWNER_USER_ID;
  upsertRuntimeSnapshot.mockResolvedValue(storedRow);
});

afterEach(() => {
  delete process.env.ASI_RUNTIME_INGEST_TOKEN;
  delete process.env.ASI_RUNTIME_OWNER_USER_ID;
});

describe('POST /api/internal/asi-runtime/snapshot', () => {
  it('rejects requests without Bearer token', async () => {
    const { POST } = await import('../route');
    const response = await POST(postRequest(validPayload));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ ok: false, message: 'Доступ запрещён.' });
    expect(upsertRuntimeSnapshot).not.toHaveBeenCalled();
  });

  it('rejects invalid token', async () => {
    const { POST } = await import('../route');
    const response = await POST(postRequest(validPayload, 'wrong-token'));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ ok: false, message: 'Доступ запрещён.' });
    expect(upsertRuntimeSnapshot).not.toHaveBeenCalled();
  });

  it('accepts valid token and returns taskId with updatedAt', async () => {
    const { POST } = await import('../route');
    const response = await POST(postRequest(validPayload, INGEST_TOKEN));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      taskId: 'task-42',
      updatedAt: '2026-07-20T11:00:00.000Z',
    });
    expect(body).not.toHaveProperty('userId');
    expect(body).not.toHaveProperty('token');
  });

  it('ignores userId from body and writes only ASI_RUNTIME_OWNER_USER_ID', async () => {
    const { POST } = await import('../route');
    const response = await POST(postRequest({ ...validPayload, userId: 'attacker-user' }, INGEST_TOKEN));

    expect(response.status).toBe(400);
    expect(upsertRuntimeSnapshot).not.toHaveBeenCalled();

    const accepted = await POST(postRequest(validPayload, INGEST_TOKEN));
    expect(accepted.status).toBe(200);
    expect(upsertRuntimeSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      userId: OWNER_USER_ID,
      taskId: 'task-42',
    }));
    expect(upsertRuntimeSnapshot.mock.calls[0][0]).not.toHaveProperty('userId', 'attacker-user');
  });

  it('rejects extra fields', async () => {
    const { POST } = await import('../route');
    const response = await POST(postRequest({ ...validPayload, command: 'npm test' }, INGEST_TOKEN));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ ok: false, message: 'Некорректный Runtime snapshot.' });
    expect(upsertRuntimeSnapshot).not.toHaveBeenCalled();
  });

  it('rejects progressPercent outside range', async () => {
    const { POST } = await import('../route');
    const response = await POST(postRequest({ ...validPayload, progressPercent: 150 }, INGEST_TOKEN));

    expect(response.status).toBe(400);
    expect(upsertRuntimeSnapshot).not.toHaveBeenCalled();
  });

  it('rejects oversized payload', async () => {
    const { POST } = await import('../route');
    const response = await POST(new Request('http://localhost/api/internal/asi-runtime/snapshot', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${INGEST_TOKEN}`,
        'content-type': 'application/json',
        'content-length': String(20_000),
      },
      body: JSON.stringify(validPayload),
    }));

    expect(response.status).toBe(400);
    expect(upsertRuntimeSnapshot).not.toHaveBeenCalled();
  });

  it('does not persist secrets or local paths', async () => {
    const { POST } = await import('../route');
    const response = await POST(postRequest({
      ...validPayload,
      lastEvent: 'Bearer sk-live-secret-token',
    }, INGEST_TOKEN));

    expect(response.status).toBe(400);
    expect(upsertRuntimeSnapshot).not.toHaveBeenCalled();
  });

  it('upserts one row per owner user on repeated POST', async () => {
    const { POST } = await import('../route');
    const first = await POST(postRequest(validPayload, INGEST_TOKEN));
    const second = await POST(postRequest({ ...validPayload, progressPercent: 80 }, INGEST_TOKEN));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(upsertRuntimeSnapshot).toHaveBeenCalledTimes(2);
    expect(upsertRuntimeSnapshot.mock.calls.every(([input]) => input.userId === OWNER_USER_ID)).toBe(true);
  });

  it('existing GET returns updated public snapshot for the owner user', async () => {
    getSession.mockResolvedValue({ userId: OWNER_USER_ID, email: 'owner@example.com' });
    getRuntimeSnapshotForUser.mockResolvedValue(storedRow);

    const { POST } = await import('../route');
    await POST(postRequest(validPayload, INGEST_TOKEN));

    const { GET } = await import('@/app/api/cabinet/runtime/status/route');
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.connected).toBe(true);
    expect(body.snapshot.taskId).toBe('task-42');
    expect(body.snapshot.updatedAt).toBe('2026-07-20T11:00:00.000Z');
    expect(body.snapshot).not.toHaveProperty('userId');
    expect(getRuntimeSnapshotForUser).toHaveBeenCalledWith(OWNER_USER_ID);
  });
});
