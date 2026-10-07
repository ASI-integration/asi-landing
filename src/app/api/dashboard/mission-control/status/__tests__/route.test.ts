import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

const requireDevelopmentOwnerSession = vi.fn();
const getMissionControlDashboard = vi.fn();

vi.mock('@/lib/development/api-auth', () => ({
  requireDevelopmentOwnerSession,
}));

vi.mock('@/lib/mission-control/store', () => ({
  getMissionControlDashboard,
}));

beforeEach(() => {
  vi.resetModules();
  requireDevelopmentOwnerSession.mockReset();
  getMissionControlDashboard.mockReset();
});

describe('GET /api/dashboard/mission-control/status', () => {
  it('returns the owner auth error before reading project status', async () => {
    requireDevelopmentOwnerSession.mockResolvedValue({
      error: NextResponse.json({ ok: false, message: 'Нет доступа.' }, { status: 403 }),
    });

    const { GET } = await import('../route');
    const response = await GET();

    expect(response.status).toBe(403);
    expect(getMissionControlDashboard).not.toHaveBeenCalled();
  });

  it('returns safe dashboard telemetry for the development owner', async () => {
    requireDevelopmentOwnerSession.mockResolvedValue({
      session: { userId: 'owner-user', email: 'owner@example.test' },
    });
    getMissionControlDashboard.mockResolvedValue([
      {
        projectId: 'kim',
        name: 'KIM',
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
        receivedAt: '2026-10-07T10:25:50.000Z',
        stale: false,
        ageSeconds: 1,
      },
    ]);

    const { GET } = await import('../route');
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0]).toMatchObject({
      projectId: 'kim',
      status: 'running',
      progressPercent: 3.4,
    });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('fails closed when telemetry storage cannot be read', async () => {
    requireDevelopmentOwnerSession.mockResolvedValue({
      session: { userId: 'owner-user', email: 'owner@example.test' },
    });
    getMissionControlDashboard.mockRejectedValue(new Error('storage unavailable'));

    const { GET } = await import('../route');
    const response = await GET();

    expect(response.status).toBe(500);
  });
});
