import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const saveMissionControlStatus = vi.fn();

vi.mock('@/lib/mission-control/store', () => ({
  saveMissionControlStatus,
}));

const INGEST_TOKEN = 'mission-control-ingest-token-test';
const INTERNAL_TEST_SECRET = 'mission-control-internal-test-secret';

const validPayload = {
  projectId: 'kim',
  status: 'running',
  stage: 'ТРАНСКРИПЦИЯ',
  progressPercent: 3.4,
  stageProgressPercent: 72,
  completedItems: 0,
  totalItems: 21,
  currentItem: 'Beyond the Matrix Episode 7',
  speed: '1.32× realtime',
  eta: '26:23',
  lastEvent: 'Файл 1/21',
  updatedAt: '2026-10-07T10:25:49.000Z',
};

function request(body: unknown, token?: string, internalSecret?: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  if (internalSecret !== undefined) headers['x-internal-test-secret'] = internalSecret;
  return new Request('http://localhost/api/internal/mission-control/status', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetModules();
  saveMissionControlStatus.mockReset();
  process.env.ASI_RUNTIME_INGEST_TOKEN = INGEST_TOKEN;
  process.env.INTERNAL_TEST_SECRET = INTERNAL_TEST_SECRET;
  saveMissionControlStatus.mockImplementation(async (payload) => ({
    ...payload,
    receivedAt: '2026-10-07T10:26:00.000Z',
  }));
});

afterEach(() => {
  delete process.env.ASI_RUNTIME_INGEST_TOKEN;
  delete process.env.INTERNAL_TEST_SECRET;
});

describe('POST /api/internal/mission-control/status', () => {
  it('fails closed without any accepted internal credential', async () => {
    const { POST } = await import('../route');
    const response = await POST(request(validPayload));

    expect(response.status).toBe(401);
    expect(saveMissionControlStatus).not.toHaveBeenCalled();
  });

  it('accepts the already-provisioned internal test secret as a local reporter credential', async () => {
    delete process.env.ASI_RUNTIME_INGEST_TOKEN;
    const { POST } = await import('../route');
    const response = await POST(request(validPayload, undefined, INTERNAL_TEST_SECRET));

    expect(response.status).toBe(200);
    expect(saveMissionControlStatus).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid project ids and unsafe payload strings', async () => {
    const { POST } = await import('../route');

    const unknown = await POST(request({ ...validPayload, projectId: 'other' }, INGEST_TOKEN));
    expect(unknown.status).toBe(400);

    const unsafe = await POST(request({
      ...validPayload,
      lastEvent: String.raw`C:\Users\Admin\secret.txt`,
    }, INGEST_TOKEN));
    expect(unsafe.status).toBe(400);

    expect(saveMissionControlStatus).not.toHaveBeenCalled();
  });

  it('accepts an explicitly unknown overall progress value', async () => {
    const { POST } = await import('../route');
    const response = await POST(request({ ...validPayload, progressPercent: null }, INGEST_TOKEN));

    expect(response.status).toBe(200);
    expect(saveMissionControlStatus).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'kim',
      progressPercent: null,
    }));
  });

  it('stores only the bounded validated status payload', async () => {
    const { POST } = await import('../route');
    const response = await POST(request(validPayload, INGEST_TOKEN));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      projectId: 'kim',
      receivedAt: '2026-10-07T10:26:00.000Z',
    });
    expect(saveMissionControlStatus).toHaveBeenCalledTimes(1);
    expect(saveMissionControlStatus).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'kim',
      status: 'running',
      stage: 'ТРАНСКРИПЦИЯ',
      progressPercent: 3.4,
      stageProgressPercent: 72,
    }));
    expect(saveMissionControlStatus.mock.calls[0][0]).not.toHaveProperty('token');
    expect(saveMissionControlStatus.mock.calls[0][0]).not.toHaveProperty('path');
  });
});
