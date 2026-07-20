import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getSession = vi.fn();
const isSessionSecretConfigured = vi.fn(() => true);
const getRuntimeSnapshotForUser = vi.fn();

vi.mock('@/lib/auth', () => ({
  getSession,
  isSessionSecretConfigured,
}));

vi.mock('@/lib/asi-runtime/repository', () => ({
  getRuntimeSnapshotForUser,
}));

beforeEach(() => {
  vi.resetModules();
  getSession.mockReset();
  isSessionSecretConfigured.mockReset();
  getRuntimeSnapshotForUser.mockReset();
  isSessionSecretConfigured.mockReturnValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

const sampleRow = {
  user_id: 'user-1',
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
  updated_at: '2026-07-20T10:15:00.000Z',
  payload_version: 1,
};

describe('GET /api/cabinet/runtime/status', () => {
  it('returns 401 for unauthenticated requests', async () => {
    getSession.mockResolvedValueOnce({ userId: '', email: '' });

    const { GET } = await import('../route');
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.ok).toBe(false);
    expect(getRuntimeSnapshotForUser).not.toHaveBeenCalled();
  });

  it('returns empty connected state when the user has no snapshot', async () => {
    getSession.mockResolvedValueOnce({ userId: 'user-1', email: 'owner@example.com' });
    getRuntimeSnapshotForUser.mockResolvedValueOnce(null);

    const { GET } = await import('../route');
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      connected: false,
      message: 'Данные Runtime ещё не поступали',
    });
    expect(getRuntimeSnapshotForUser).toHaveBeenCalledWith('user-1');
  });

  it('returns only the current user snapshot', async () => {
    getSession.mockResolvedValueOnce({ userId: 'user-1', email: 'owner@example.com' });
    getRuntimeSnapshotForUser.mockResolvedValueOnce(sampleRow);

    const { GET } = await import('../route');
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.connected).toBe(true);
    expect(body.snapshot.taskId).toBe('task-42');
    expect(body.snapshot.taskTitle).toBe('Добавить runtime snapshot');
    expect(getRuntimeSnapshotForUser).toHaveBeenCalledWith('user-1');
    expect(body.snapshot).not.toHaveProperty('userId');
    expect(body.snapshot).not.toHaveProperty('user_id');
    expect(body.snapshot).not.toHaveProperty('token');
    expect(body.snapshot).not.toHaveProperty('secret');
    expect(body.snapshot).not.toHaveProperty('env');
    expect(body.snapshot).not.toHaveProperty('command');
    expect(body.snapshot).not.toHaveProperty('absolutePath');
    expect(body.snapshot).not.toHaveProperty('payload');
  });
});
