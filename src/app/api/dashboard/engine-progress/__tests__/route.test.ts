import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('server-only', () => ({}));

const requireDevelopmentOwnerSession = vi.fn();
const getEngineProgressSnapshot = vi.fn();

vi.mock('@/lib/development/api-auth', () => ({ requireDevelopmentOwnerSession }));
vi.mock('@/lib/engine-progress/server', () => ({ getEngineProgressSnapshot }));

beforeEach(() => {
  vi.resetModules();
  requireDevelopmentOwnerSession.mockReset();
  getEngineProgressSnapshot.mockReset();
});

describe('GET /api/dashboard/engine-progress owner-only', () => {
  it.each([401, 403])('refuses unauthorized access with %i and does not read progress', async (status) => {
    requireDevelopmentOwnerSession.mockResolvedValue({
      error: NextResponse.json({ ok: false }, { status }),
    });
    const { GET } = await import('../route');
    const response = await GET();
    expect(response.status).toBe(status);
    expect(getEngineProgressSnapshot).not.toHaveBeenCalled();
  });

  it('sends private no-store owner data and no secret values', async () => {
    requireDevelopmentOwnerSession.mockResolvedValue({ session: { userId: 'owner' } });
    getEngineProgressSnapshot.mockResolvedValue({
      schemaVersion: 'asi.owner.engine-progress.v1',
      fetchedAt: '2026-10-10T18:00:00.000Z',
      snapshotDate: '2026-10-10',
      milestones: [],
      steps: [],
      ci: { available: false, reason: 'Источник не настроен.', sha: null },
      activity: null,
    });
    const { GET } = await import('../route');
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect((await response.json()).ci.available).toBe(false);
    expect(getEngineProgressSnapshot).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the status provider fails', async () => {
    requireDevelopmentOwnerSession.mockResolvedValue({ session: { userId: 'owner' } });
    getEngineProgressSnapshot.mockRejectedValue(new Error('sensitive backend error'));
    const { GET } = await import('../route');
    const response = await GET();
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('sensitive backend error');
  });
});
