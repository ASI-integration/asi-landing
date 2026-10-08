import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';
const requireCrmOperatorSession = vi.hoisted(() => vi.fn());
const getPilotObjectSummary = vi.hoisted(() => vi.fn());
const savePilotObjectIntake = vi.hoisted(() => vi.fn());

vi.mock('@/lib/crm/api-auth', () => ({ requireCrmOperatorSession }));
vi.mock('@/lib/communication/pilot-object-intake', () => ({
  normalizePilotObjectInput: (v: unknown) => v,
  savePilotObjectIntake,
  getPilotObjectSummary,
}));

beforeEach(() => {
  requireCrmOperatorSession.mockReset();
  getPilotObjectSummary.mockReset();
  savePilotObjectIntake.mockReset();
});

describe('operator-only detailed pilot object API', () => {
  it('rejects anonymous read without fetching PII', async () => {
    requireCrmOperatorSession.mockResolvedValueOnce({
      error: NextResponse.json({ ok: false }, { status: 401 }),
    });
    const { GET } = await import('../route');
    const res = await GET(new Request('https://asi.test/api/early-access/objects?objectId=pilot_sensitive'));
    expect(res.status).toBe(401);
    expect(getPilotObjectSummary).not.toHaveBeenCalled();
  });

  it('rejects anonymous full-object write before parsing or saving secrets', async () => {
    requireCrmOperatorSession.mockResolvedValueOnce({
      error: NextResponse.json({ ok: false }, { status: 403 }),
    });
    const { POST } = await import('../route');
    const res = await POST(new Request('https://asi.test/api/early-access/objects', {
      method: 'POST', body: JSON.stringify({ ownerContact: 'private', wifiPassword: 'secret' }),
    }));
    expect(res.status).toBe(403);
    expect(savePilotObjectIntake).not.toHaveBeenCalled();
  });

  it('allows authenticated operator to retrieve a detailed object summary', async () => {
    requireCrmOperatorSession.mockResolvedValueOnce({ session: { userId: 'operator' } });
    getPilotObjectSummary.mockResolvedValueOnce({ objectId: 'pilot_123', ownerContact: 'private' });
    const { GET } = await import('../route');
    const res = await GET(new Request('https://asi.test/api/early-access/objects?objectId=pilot_123'));
    expect(res.status).toBe(200);
    expect(getPilotObjectSummary).toHaveBeenCalledWith('pilot_123');
  });
});
