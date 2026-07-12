import { beforeEach, describe, expect, it, vi } from 'vitest';

const { recordAndProcessBookingEvent } = vi.hoisted(() => ({ recordAndProcessBookingEvent: vi.fn() }));
vi.mock('../lifecycle-autopilot-service', () => ({
  durableEventId: (...parts: string[]) => `id:${parts.join(':')}`,
  recordAndProcessBookingEvent,
}));

import { emitLifecycleForAction, emitPhysicalLifecycle } from '../lifecycle-entry-adapter';

describe('OPS v16 lifecycle entry adapters', () => {
  beforeEach(() => {
    recordAndProcessBookingEvent.mockReset();
    recordAndProcessBookingEvent.mockResolvedValue({ processed: true, duplicate: false });
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

  it.each([
    ['update_cleaning', 'completed', 'cleaner.task_completed'],
    ['update_linen', 'delivered', 'linen.task_completed'],
    ['update_supplies', 'completed', 'consumables.task_completed'],
    ['create_maintenance', '', 'damage.reported'],
    ['update_maintenance', 'resolved', 'maintenance.task_completed'],
    ['final_approval', '', 'inspection.completed'],
  ])('maps worker action %s to %s', async (action, status, type) => {
    await emitPhysicalLifecycle({ bookingId: 'booking-1', action, body: { id: 'work-1', status } });
    expect(recordAndProcessBookingEvent).toHaveBeenLastCalledWith(expect.objectContaining({ type, bookingId: 'booking-1' }));
  });

  it('uses deterministic IDs so repeated action values deduplicate in persistence', async () => {
    const input = { bookingId: 'booking-1', action: 'verify_documents', source: 'legal_payment', payload: { revision: 1 } };
    await emitLifecycleForAction(input);
    await emitLifecycleForAction(input);
    expect(recordAndProcessBookingEvent.mock.calls[0][0].id).toBe(recordAndProcessBookingEvent.mock.calls[1][0].id);
  });
});
