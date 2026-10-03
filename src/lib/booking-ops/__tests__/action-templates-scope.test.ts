import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getBookingOpsRecord: vi.fn(),
  requireBookingOpsRecordScope: vi.fn(),
  updateBookingOpsRecord: vi.fn(),
}));

vi.mock('../repository', () => ({
  getBookingOpsRecord: mocks.getBookingOpsRecord,
  requireBookingOpsRecordScope: mocks.requireBookingOpsRecordScope,
  updateBookingOpsRecord: mocks.updateBookingOpsRecord,
}));

import { applyBookingOpsOperatorAction } from '../action-templates';

const record = {
  id: 'ops-1',
  bookingId: 'booking-1',
  accountId: 'account-a',
  guestName: 'Guest',
  guestPhone: '+79990000001',
  guestEmail: null,
  guestTelegram: null,
  propertyId: 'property-a',
  propertyLabel: 'Apartment',
  otaSource: 'manual',
  checkInAt: '2026-10-10T14:00:00.000Z',
  checkOutAt: '2026-10-12T11:00:00.000Z',
  opsStatus: 'created',
  manualNextAction: null,
  isBlocked: false,
  blockerReason: null,
  documentsStatus: 'not_started',
  contractStatus: 'not_started',
  depositStatus: 'not_started',
  mvdStatus: 'not_required',
  checkinReadinessStatus: 'not_started',
  unitReadinessStatus: 'not_ready',
  notes: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

describe('Booking Ops action mutation tenant scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBookingOpsRecord.mockResolvedValue({ ...record });
    mocks.requireBookingOpsRecordScope.mockResolvedValue({ ...record });
    mocks.updateBookingOpsRecord.mockResolvedValue({ ok: true, record: { ...record, documentsStatus: 'requested' } });
  });

  it('rejects a record outside the expected account/property before update', async () => {
    mocks.requireBookingOpsRecordScope.mockRejectedValueOnce(new Error('booking_scope_mismatch'));

    const result = await applyBookingOpsOperatorAction(
      record.id,
      'request_guest_documents',
      { expectedScope: { accountId: 'account-a', propertyId: 'property-a' } },
    );

    expect(result).toEqual({ ok: false, error: 'scope_mismatch' });
    expect(mocks.updateBookingOpsRecord).not.toHaveBeenCalled();
  });

  it('passes expected scope into the repository mutation and fails closed on a raced scope change', async () => {
    mocks.updateBookingOpsRecord.mockResolvedValueOnce({ ok: false, error: 'scope_mismatch' });

    const result = await applyBookingOpsOperatorAction(
      record.id,
      'request_guest_documents',
      { expectedScope: { accountId: 'account-a', propertyId: 'property-a' } },
    );

    expect(result).toEqual({ ok: false, error: 'scope_mismatch' });
    expect(mocks.updateBookingOpsRecord).toHaveBeenCalledWith(
      record.id,
      expect.any(Object),
      { expectedScope: { accountId: 'account-a', propertyId: 'property-a' } },
    );
  });
});
