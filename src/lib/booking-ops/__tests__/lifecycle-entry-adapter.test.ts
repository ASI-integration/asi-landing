import { beforeEach, describe, expect, it, vi } from 'vitest';

const { recordAndProcessBookingEvent, requireBookingOpsRecordScope } = vi.hoisted(() => ({
  recordAndProcessBookingEvent: vi.fn(),
  requireBookingOpsRecordScope: vi.fn(),
}));
vi.mock('../lifecycle-autopilot-service', () => ({
  durableEventId: (...parts: string[]) => `id:${parts.join(':')}`,
  recordAndProcessBookingEvent,
}));
vi.mock('../repository', () => ({ requireBookingOpsRecordScope }));

import { emitLifecycleForAction, emitPhysicalLifecycle } from '../lifecycle-entry-adapter';

describe('OPS v16 lifecycle entry adapters', () => {
  beforeEach(() => {
    recordAndProcessBookingEvent.mockReset();
    recordAndProcessBookingEvent.mockResolvedValue({ processed: true, duplicate: false });
    requireBookingOpsRecordScope.mockReset();
    requireBookingOpsRecordScope.mockResolvedValue({ id: 'booking-1' });
  });

  it.each([
    ['documents_received', 'guest.documents_received'],
    ['verify_documents', 'guest.documents_verified'],
    ['prepare_contract', 'contract.generated'],
    ['request_deposit', 'deposit.requested'],
    ['deposit_received', 'deposit.confirmed'],
    ['mark_mvd_not_required', 'mvd.not_required'],
    ['mark_instructions_sent', 'checkin.instructions_released'],
    ['mark_guest_checked_in', 'guest.checked_in'],
    ['mark_guest_checked_out', 'checkout.started'],
    ['mark_post_checkout_inspection_done', 'checkout.inspection_completed'],
    ['mark_deposit_return_ready', 'deposit.returned'],
    ['mark_booking_closed', 'booking.closed'],
  ])('maps legal and operational action %s to %s', async (action, type) => {
    await emitLifecycleForAction({ bookingId: 'booking-1', action, source: 'test' });
    expect(recordAndProcessBookingEvent).toHaveBeenLastCalledWith(expect.objectContaining({ type, bookingId: 'booking-1' }));
  });

  it('revalidates canonical scope before emitting a mapped lifecycle event', async () => {
    requireBookingOpsRecordScope.mockRejectedValueOnce(new Error('booking_scope_mismatch'));

    await expect(emitLifecycleForAction({
      bookingId: 'booking-1',
      action: 'mark_guest_checked_out',
      source: 'test',
      expectedScope: { accountId: 'account-a', propertyId: 'property-a' },
    })).rejects.toThrow('booking_scope_mismatch');

    expect(recordAndProcessBookingEvent).not.toHaveBeenCalled();
  });

  it.each([
    ['update_cleaning', 'verified', 'cleaner.task_completed'],
    ['update_linen', 'delivered', 'linen.task_completed'],
    ['update_supplies', 'completed', 'consumables.task_completed'],
    ['create_maintenance', '', 'damage.reported'],
    ['update_maintenance', 'resolved', 'maintenance.task_completed'],
    ['final_approval', '', 'inspection.completed'],
  ])('maps worker action %s to %s', async (action, status, type) => {
    await emitPhysicalLifecycle({ bookingId: 'booking-1', action, body: { id: 'work-1', status } });
    expect(recordAndProcessBookingEvent).toHaveBeenLastCalledWith(expect.objectContaining({ type, bookingId: 'booking-1' }));
  });

  it.each([
    ['update_cleaning', 'verified'], ['update_linen', 'delivered'],
    ['update_supplies', 'completed'], ['create_maintenance', ''],
    ['update_maintenance', 'resolved'], ['final_approval', ''],
  ])('rejects physical %s lifecycle emission after scope changes', async (action, status) => {
    requireBookingOpsRecordScope.mockRejectedValueOnce(new Error('booking_scope_mismatch'));
    await expect(emitPhysicalLifecycle({
      bookingId: 'booking-1', action, body: { status },
      expectedScope: { accountId: 'account-a', propertyId: 'property-a' },
    })).rejects.toThrow('booking_scope_mismatch');
    expect(recordAndProcessBookingEvent).not.toHaveBeenCalled();
  });

  it('does not map completed cleaning to cleaner.task_completed before verification', async () => {
    await emitPhysicalLifecycle({ bookingId: 'booking-1', action: 'update_cleaning', body: { id: 'work-1', status: 'completed' } });
    expect(recordAndProcessBookingEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'cleaner.task_completed' }));
  });

  it('uses deterministic IDs so repeated action values deduplicate in persistence', async () => {
    const input = { bookingId: 'booking-1', action: 'verify_documents', source: 'legal_payment', payload: { revision: 1 } };
    await emitLifecycleForAction(input);
    await emitLifecycleForAction(input);
    expect(recordAndProcessBookingEvent.mock.calls[0][0].id).toBe(recordAndProcessBookingEvent.mock.calls[1][0].id);
  });
});
