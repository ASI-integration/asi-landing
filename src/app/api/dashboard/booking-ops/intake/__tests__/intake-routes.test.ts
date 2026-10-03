import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/crm/api-auth', () => ({
  requireCrmOperatorSession: vi.fn(async () => ({
    error: Response.json({ ok: false }, { status: 401 }),
  })),
  requireOpsAdminSession: vi.fn(async () => ({
    error: Response.json({ ok: false }, { status: 401 }),
  })),
}));

vi.mock('../../access', () => ({
  requireBookingOpsApiAccount: vi.fn(async () => ({
    ok: true, accountId: 'account-1', actorId: 'operator-1',
  })),
  requireBookingOpsApiPropertyAccess: vi.fn(async (_session, propertyId: string) => ({
    ok: true, accountId: 'account-1', actorId: 'operator-1', propertyId,
  })),
  requireBookingOpsApiAccess: vi.fn(async (_session, bookingId: string) => ({
    ok: true, accountId: 'account-1', actorId: 'operator-1', bookingId, propertyId: 'property-1',
  })),
}));

vi.mock('@/lib/booking-ops/lifecycle-autopilot-service', () => ({
  recordAndProcessBookingEvent: vi.fn(async () => ({ processed: true })),
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

describe('Booking Ops intake tenant scope', () => {
  it('binds dashboard processing to account and canonical referenced scopes', async () => {
    const auth = await import('@/lib/crm/api-auth');
    const access = await import('../../access');
    const autopilot = await import('@/lib/booking-ops/real-booking-intake-autopilot');
    vi.mocked(auth.requireOpsAdminSession).mockResolvedValueOnce({
      session: { userId: 'operator-1', email: 'operator@asi.test' },
    } as never);
    vi.mocked(autopilot.processInboundBookingRequest).mockResolvedValueOnce({
      intakeId: 'intake-1', bookingId: null, guestId: null, intakeStatus: 'needs_review',
      initializedModules: [], createdCommunicationIntents: [], missingRequiredFields: ['dates'],
      nextRequiredActions: ['collect_dates'], fallbackCreated: false,
      duplicateOfBookingId: 'booking-1', safeSummary: 'ok',
    });

    const { POST } = await import('@/app/api/dashboard/booking-ops/intake/process/route');
    const body = {
      source: 'admin', propertyId: 'property-1', duplicateOfBookingId: 'booking-1', guestName: 'Guest',
    };
    const res = await POST(new Request('http://localhost/api/dashboard/booking-ops/intake/process', {
      method: 'POST', body: JSON.stringify(body),
    }));

    expect(res.status).toBe(200);
    expect(access.requireBookingOpsApiPropertyAccess).toHaveBeenCalledWith(
      expect.anything(), 'property-1',
    );
    expect(access.requireBookingOpsApiAccess).toHaveBeenCalledWith(expect.anything(), 'booking-1');
    expect(autopilot.processInboundBookingRequest).toHaveBeenCalledWith(
      body,
      'admin',
      expect.objectContaining({ accountId: 'account-1', inputTrust: 'authenticated_internal' }),
    );
  });

  it('emits dashboard lifecycle events only after canonical property-bound access resolves', async () => {
    const auth = await import('@/lib/crm/api-auth');
    const access = await import('../../access');
    const autopilot = await import('@/lib/booking-ops/real-booking-intake-autopilot');
    const lifecycle = await import('@/lib/booking-ops/lifecycle-autopilot-service');
    vi.mocked(access.requireBookingOpsApiAccess).mockClear();
    vi.mocked(lifecycle.recordAndProcessBookingEvent).mockClear();
    vi.mocked(auth.requireOpsAdminSession).mockResolvedValueOnce({
      session: { userId: 'operator-1', email: 'operator@asi.test' },
    } as never);
    vi.mocked(autopilot.processInboundBookingRequest).mockResolvedValueOnce({
      intakeId: 'intake-bound', bookingId: 'booking-bound', guestId: 'guest-1', intakeStatus: 'processed',
      initializedModules: ['lifecycle_sync'], createdCommunicationIntents: [], missingRequiredFields: [],
      nextRequiredActions: [], fallbackCreated: false, duplicateOfBookingId: null, safeSummary: 'ok',
    });

    const { POST } = await import('@/app/api/dashboard/booking-ops/intake/process/route');
    const res = await POST(new Request('http://localhost/api/dashboard/booking-ops/intake/process', {
      method: 'POST', body: JSON.stringify({ source: 'admin', guestName: 'Guest' }),
    }));

    expect(res.status).toBe(200);
    expect(access.requireBookingOpsApiAccess).toHaveBeenCalledWith(expect.anything(), 'booking-bound');
    expect(lifecycle.recordAndProcessBookingEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 'booking-bound',
        objectId: 'property-1',
        actorType: 'operator',
        source: 'booking_intake:admin',
      }),
      { accountId: 'account-1', propertyId: 'property-1' },
    );
  });

  it('keeps property-unbound dashboard review items free of lifecycle side effects', async () => {
    const auth = await import('@/lib/crm/api-auth');
    const access = await import('../../access');
    const autopilot = await import('@/lib/booking-ops/real-booking-intake-autopilot');
    const lifecycle = await import('@/lib/booking-ops/lifecycle-autopilot-service');
    vi.mocked(access.requireBookingOpsApiAccess).mockClear();
    vi.mocked(lifecycle.recordAndProcessBookingEvent).mockClear();
    vi.mocked(auth.requireOpsAdminSession).mockResolvedValueOnce({
      session: { userId: 'operator-1', email: 'operator@asi.test' },
    } as never);
    vi.mocked(autopilot.processInboundBookingRequest).mockResolvedValueOnce({
      intakeId: 'intake-unbound', bookingId: 'booking-unbound', guestId: 'guest-1', intakeStatus: 'needs_review',
      initializedModules: [], createdCommunicationIntents: [], missingRequiredFields: ['property'],
      nextRequiredActions: ['attach_property'], fallbackCreated: false, duplicateOfBookingId: null, safeSummary: 'review',
    });

    const { POST } = await import('@/app/api/dashboard/booking-ops/intake/process/route');
    const res = await POST(new Request('http://localhost/api/dashboard/booking-ops/intake/process', {
      method: 'POST', body: JSON.stringify({ source: 'admin', guestName: 'Guest' }),
    }));

    expect(res.status).toBe(200);
    expect(access.requireBookingOpsApiAccess).not.toHaveBeenCalled();
    expect(lifecycle.recordAndProcessBookingEvent).not.toHaveBeenCalled();
  });

  it('scopes dashboard status and event reads to the authenticated account', async () => {
    const auth = await import('@/lib/crm/api-auth');
    const autopilot = await import('@/lib/booking-ops/real-booking-intake-autopilot');
    vi.mocked(auth.requireCrmOperatorSession).mockResolvedValue({
      session: { userId: 'operator-1', email: 'operator@asi.test' },
    } as never);
    vi.mocked(autopilot.getInboundBookingIntakeStatus).mockResolvedValueOnce(null);

    const statusRoute = await import('@/app/api/dashboard/booking-ops/intake/status/route');
    await statusRoute.GET(new Request('http://localhost/api/dashboard/booking-ops/intake/status?intakeId=i-1'));
    expect(autopilot.getInboundBookingIntakeStatus).toHaveBeenCalledWith(
      { bookingId: undefined, intakeId: 'i-1' }, 'account-1',
    );

    const eventsRoute = await import('@/app/api/dashboard/booking-ops/intake/events/route');
    await eventsRoute.GET(new Request('http://localhost/api/dashboard/booking-ops/intake/events'));
    expect(autopilot.listInboundIntakeEventsEnriched).toHaveBeenCalledWith(30, 'account-1');
  });
});

describe('Public web intake validation', () => {
  beforeEach(async () => {
    const autopilot = await import('@/lib/booking-ops/real-booking-intake-autopilot');
    vi.mocked(autopilot.processInboundBookingRequest).mockReset();
    vi.mocked(autopilot.validatePublicWebIntakePayload).mockReset();
    vi.mocked(autopilot.validatePublicWebIntakePayload).mockReturnValue(null);
  });

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

  it('rejects authoritative fields before calling the intake service', async () => {
    const autopilot = await import('@/lib/booking-ops/real-booking-intake-autopilot');
    vi.mocked(autopilot.validatePublicWebIntakePayload).mockReturnValueOnce(
      'Публичная заявка содержит недопустимые служебные поля.',
    );
    const { POST } = await import('@/app/api/booking-ops/intake/web/route');
    const res = await POST(new Request('http://localhost/api/booking-ops/intake/web', {
      method: 'POST',
      body: JSON.stringify({
        guestName: 'Атакующий',
        rawMessageText: 'Заявка',
        propertyId: 'foreign-property',
      }),
    }));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      ok: false,
      message: 'Публичная заявка содержит недопустимые служебные поля.',
    });
    expect(autopilot.processInboundBookingRequest).not.toHaveBeenCalled();
  });
});
