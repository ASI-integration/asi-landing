import { describe, expect, it, vi } from 'vitest';
import type { BookingOpsRecord } from '../types';

const mocks = vi.hoisted(() => ({ scope: vi.fn(), from: vi.fn() }));
vi.mock('../repository', () => ({ requireBookingOpsRecordScope: mocks.scope }));
vi.mock('../tasks', () => ({ createBookingOpsTask: vi.fn() }));
vi.mock('../lifecycle', () => ({ syncLifecycleFromBookingOpsRecord: vi.fn() }));
vi.mock('../events', () => ({ recordBookingOpsEvent: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }));

import { syncGuestIntakeAutopilot } from '../guest-intake-autopilot';

const expectedScope = { accountId: 'account-a', propertyId: 'property-a' };
const record = {
  id: 'ops-a',
  bookingId: 'booking-a',
  propertyId: 'property-a',
  guestName: 'Guest',
  guestCount: 1,
  opsStatus: 'created',
  isBlocked: false,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
} as BookingOpsRecord;

describe('guest intake autopilot execution scope', () => {
  it('fails before storage when canonical ownership no longer matches', async () => {
    mocks.scope.mockRejectedValue(new Error('booking_scope_mismatch'));
    await expect(syncGuestIntakeAutopilot(record, expectedScope)).rejects.toThrow('booking_scope_mismatch');
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
