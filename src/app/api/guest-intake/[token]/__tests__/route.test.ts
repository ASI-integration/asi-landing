import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  opened: vi.fn(),
  parse: vi.fn((body: unknown) => body),
  event: vi.fn(),
  eventId: vi.fn((...parts: string[]) => parts.join(':')),
}));
vi.mock('@/lib/booking-ops/guest-intake-inbound', () => ({
  loadGuestIntakeByToken: vi.fn(),
  submitGuestIntake: mocks.submit,
  recordGuestIntakeLinkOpened: mocks.opened,
  parseGuestIntakeSubmission: mocks.parse,
}));
vi.mock('@/lib/booking-ops/lifecycle-autopilot-service', () => ({
  recordAndProcessBookingEvent: mocks.event,
  durableEventId: mocks.eventId,
}));
vi.mock('@/lib/booking-ops/guest-intake-state', () => ({ GUEST_INTAKE_FIELD_LABELS_RU: {} }));

import { POST } from '../route';
const session = {
  id: 'session-1',
  intakeStatus: 'completed',
  missingFields: [],
  validationErrors: [],
  lastGuestActivityAt: null,
  fallbackReason: null,
};

const record = {
  id: 'booking-1',
  accountId: 'account-a',
  propertyId: 'property-1',
  propertyLabel: 'Test property',
  documentVerificationStatus: 'uploaded',
};

describe('guest intake lifecycle scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.submit.mockResolvedValue({ ok: true, session, record, validationErrors: [], message: 'ok' });
    mocks.event.mockResolvedValue({ processed: true, duplicate: false });
  });
  it('passes canonical account/property scope to lifecycle events', async () => {
    const response = await POST(
      new Request('https://example.test', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }),
      { params: { token: 'guest-token' } },
    );
    expect(response.status).toBe(200);
    expect(mocks.event).toHaveBeenCalledTimes(2);
    expect(mocks.event).toHaveBeenNthCalledWith(1, expect.objectContaining({ bookingId: 'booking-1' }), {
      accountId: 'account-a', propertyId: 'property-1',
    });
    expect(mocks.event).toHaveBeenNthCalledWith(2, expect.objectContaining({ bookingId: 'booking-1' }), {
      accountId: 'account-a', propertyId: 'property-1',
    });
  });

  it('preserves legacy lifecycle fallback without an expected scope', async () => {
    mocks.submit.mockResolvedValue({
      ok: true, session, record: { ...record, accountId: 'legacy', propertyId: null }, validationErrors: [], message: 'ok',
    });
    const response = await POST(
      new Request('https://example.test', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }),
      { params: { token: 'guest-token' } },
    );
    expect(response.status).toBe(200);
    expect(mocks.event).toHaveBeenNthCalledWith(1, expect.any(Object), undefined);
  });
  it('fails closed before lifecycle persistence when account-bound property scope is unavailable', async () => {
    mocks.submit.mockResolvedValue({
      ok: true, session, record: { ...record, propertyId: null }, validationErrors: [], message: 'ok',
    });
    await expect(POST(
      new Request('https://example.test', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } }),
      { params: { token: 'guest-token' } },
    )).rejects.toThrow('booking_scope_unavailable');
    expect(mocks.event).not.toHaveBeenCalled();
  });
});
