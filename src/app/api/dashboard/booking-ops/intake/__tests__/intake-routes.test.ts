import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/crm/api-auth', () => ({
  requireCrmOperatorSession: vi.fn(async () => ({
    error: Response.json({ ok: false }, { status: 401 }),
  })),
  requireOpsAdminSession: vi.fn(async () => ({
    error: Response.json({ ok: false }, { status: 401 }),
  })),
}));

vi.mock('@/lib/booking-ops/real-booking-intake-autopilot', () => ({
  processInboundBookingRequest: vi.fn(),
  getInboundBookingIntakeStatus: vi.fn(),
  listInboundIntakeEventsEnriched: vi.fn(async () => []),
  checkWebIntakeRateLimit: vi.fn(() => true),
  validatePublicWebIntakePayload: vi.fn(() => null),
}));

describe('Booking Ops intake API auth', () => {
  it('dashboard process returns 401 unauthenticated', async () => {
    const { POST } = await import('@/app/api/dashboard/booking-ops/intake/process/route');
    const res = await POST(new Request('http://localhost/api/dashboard/booking-ops/intake/process', {
      method: 'POST',
      body: JSON.stringify({ guestName: 'Test' }),
    }));
    expect(res.status).toBe(401);
  });

  it('dashboard status returns 401 unauthenticated', async () => {
    const { GET } = await import('@/app/api/dashboard/booking-ops/intake/status/route');
    const res = await GET(new Request('http://localhost/api/dashboard/booking-ops/intake/status?bookingId=x'));
    expect(res.status).toBe(401);
  });

  it('dashboard events returns 401 unauthenticated', async () => {
    const { GET } = await import('@/app/api/dashboard/booking-ops/intake/events/route');
    const res = await GET(new Request('http://localhost/api/dashboard/booking-ops/intake/events'));
    expect(res.status).toBe(401);
  });

  it('internal telegram intake rejects missing secret', async () => {
    const { POST } = await import('@/app/api/internal/booking-ops/intake/telegram/route');
    const res = await POST(new Request('http://localhost/api/internal/booking-ops/intake/telegram', {
      method: 'POST',
      body: JSON.stringify({ guestName: 'TG Guest', sourceMessageId: '1' }),
    }));
    expect(res.status).toBe(401);
  });
});

describe('Public web intake validation', () => {
  it('rejects invalid payload', async () => {
    const autopilot = await import('@/lib/booking-ops/real-booking-intake-autopilot');
    vi.mocked(autopilot.validatePublicWebIntakePayload).mockReturnValueOnce('Укажите имя гостя или контакт для связи.');
    const { POST } = await import('@/app/api/booking-ops/intake/web/route');
    const res = await POST(new Request('http://localhost/api/booking-ops/intake/web', {
      method: 'POST',
      body: JSON.stringify({}),
    }));
    expect(res.status).toBe(400);
  });
});
