import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateSpatialEvidence } from '@/lib/location/spatial-validation';

const mocks = vi.hoisted(() => ({
  scope: vi.fn(),
  read: vi.fn(),
  refresh: vi.fn(),
  requireAccess: vi.fn(),
}));

vi.mock('@/lib/crm/api-auth', () => ({
  requireCrmOperatorSession: vi.fn(async () => ({
    session: { userId: 'user-1', email: 'ops@asi.test' },
  })),
  requireOpsAdminSession: vi.fn(async () => ({
    session: { userId: 'admin-1', email: 'admin@asi.test' },
  })),
}));

vi.mock('../access', () => ({
  requireBookingOpsApiAccess: mocks.requireAccess,
}));

vi.mock('@/lib/platform/residential-booking-scope', () => ({
  resolveResidentialBookingIdentity: mocks.scope,
}));
vi.mock('@/lib/location/residential-property-spatial-runtime', () => ({
  readResidentialPropertySpatialSnapshot: mocks.read,
  refreshResidentialPropertySpatialSnapshot: mocks.refresh,
}));

const identity = {
  kind: 'identified' as const,
  accountId: 'account-1',
  propertyId: 'property-1',
  bookingId: 'booking-1',
};

function validSnapshot() {
  const observedAt = new Date().toISOString();
  const scope = {
    kind: 'account' as const,
    accountId: 'account-1',
    locationId: 'property-1',
  };
  const source = {
    provider: 'provider',
    observedAt,
    origin: 'external' as const,
    delivery: 'live' as const,
  };
  const coordinates = { lat: 59.93, lon: 30.36 };
  const request = {
    scope, mode: 'residential' as const,
    purpose: 'site_assessment' as const, radiusMeters: 1000,
  };
  const location = {
    scope, mode: 'residential' as const, objectKind: 'property' as const,
    address: 'Невский проспект, 1', city: 'Санкт-Петербург', country: 'RU',
    coordinates, addressCoordinates: coordinates, source,
  };
  const evidence = {
    scope, mode: 'residential' as const, center: coordinates, radiusMeters: 1000,
    status: 'available' as const, coverage: ['poi' as const], source,
    entities: [{
      id: 'node/1', kind: 'poi' as const, category: 'park',
      name: 'Парк', coordinates, source,
    }],
  };
  const value = validateSpatialEvidence(request, location, [evidence], new Date());
  return { available: true as const, identity, observedAt, value };
}

describe('Booking Ops residential location route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAccess.mockResolvedValue({
      ok: true,
      accountId: 'account-1',
      propertyId: 'property-1',
      bookingId: 'booking-1',
    });
    mocks.scope.mockResolvedValue(identity);
    mocks.read.mockImplementation(async () => validSnapshot());
    mocks.refresh.mockImplementation(async () => validSnapshot());
  });

  it('GET returns a pure advisory property-scoped location decision', async () => {
    const route = await import('../[id]/location/route');
    const response = await route.GET(new Request('https://asi.test'), {
      params: { id: 'booking-1' },
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.requireAccess).toHaveBeenCalledWith(expect.any(Object), 'booking-1');
    expect(mocks.read).toHaveBeenCalledWith(identity);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.scope).toHaveBeenCalledTimes(2);
    expect(payload.platformDecision).toMatchObject({
      version: 'platform-decision-v0',
      domain: 'residential_location',
      topic: 'location',
      status: 'allowed',
      identity,
      permission: {
        automaticActionAllowed: false,
        executionAuthority: 'domain_revalidation_required',
        allowedActions: ['review_location'],
      },
    });
    expect(payload.platformDecision.permission.forbiddenActions)
      .toContain('send_guest_automatically');
  });

  it('fails foreign account scope before reading a spatial snapshot', async () => {
    mocks.scope.mockRejectedValueOnce(new Error('booking_scope_mismatch'));
    const route = await import('../[id]/location/route');
    const response = await route.GET(new Request('https://asi.test'), {
      params: { id: 'booking-1' },
    });

    expect(response.status).toBe(403);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('fails if booking identity changes during the GET read', async () => {
    mocks.scope
      .mockResolvedValueOnce(identity)
      .mockResolvedValueOnce({ ...identity, propertyId: 'property-2' });
    const route = await import('../[id]/location/route');
    const response = await route.GET(new Request('https://asi.test'), {
      params: { id: 'booking-1' },
    });

    expect(response.status).toBe(409);
  });

  it('POST runs only the controlled refresh seam and returns an advisory decision', async () => {
    const route = await import('../[id]/location/route');
    const response = await route.POST(new Request('https://asi.test', { method: 'POST' }), {
      params: { id: 'booking-1' },
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.refresh).toHaveBeenCalledWith(identity);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(payload.platformDecision.topic).toBe('location');
    expect(payload.platformDecision.permission.automaticActionAllowed).toBe(false);
  });

  it('maps incomplete canonical property address to a stable conflict', async () => {
    mocks.refresh.mockRejectedValueOnce(new Error('property_location_incomplete'));
    const route = await import('../[id]/location/route');
    const response = await route.POST(new Request('https://asi.test', { method: 'POST' }), {
      params: { id: 'booking-1' },
    });
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.message).toBe('Адрес объекта нужно проверить перед обновлением геоданных.');
  });
});
