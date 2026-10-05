import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getBookingOpsRecord: vi.fn(),
  requireBookingOpsRecordScope: vi.fn(),
  supabaseFrom: vi.fn(),
  recomputeGuestLegalReadiness: vi.fn(),
  ensurePhysicalTasks: vi.fn(),
  guardBookingCommunicationDraft: vi.fn(),
}));

vi.mock('../repository', () => ({
  getBookingOpsRecord: mocks.getBookingOpsRecord,
  requireBookingOpsRecordScope: mocks.requireBookingOpsRecordScope,
}));
vi.mock('@/lib/supabase', () => ({
  supabase: { from: mocks.supabaseFrom },
}));
vi.mock('../guest-legal-deposit-mvd-execution', () => ({
  recomputeGuestLegalReadiness: mocks.recomputeGuestLegalReadiness,
}));
vi.mock('../physical-readiness-execution', () => ({
  ensurePhysicalTasks: mocks.ensurePhysicalTasks,
}));
vi.mock('@/lib/communication/booking-knowledge-boundary', () => ({
  guardBookingCommunicationDraft: mocks.guardBookingCommunicationDraft,
}));

import {
  ensureGuestIntakeSession,
  getGuestIntakeReleaseSnapshot,
  prepareCheckinReleaseDraft,
  simulateCheckinRelease,
} from '../guest-intake-checkin-release';

const bookingId = '11111111-1111-4111-8111-111111111111';
const expectedScope = { accountId: 'account-a', propertyId: 'property-a' };

describe('guest intake / check-in release canonical scope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireBookingOpsRecordScope.mockRejectedValue(new Error('booking_scope_mismatch'));
  });

  it.each([
    ['session creation', () => ensureGuestIntakeSession(bookingId, expectedScope)],
    ['snapshot/recompute', () => getGuestIntakeReleaseSnapshot(bookingId, expectedScope)],
    ['release draft', () => prepareCheckinReleaseDraft(bookingId, 'operator@asi.test', expectedScope)],
    ['simulated release', () => simulateCheckinRelease(bookingId, true, 'operator@asi.test', expectedScope)],
  ])('fails closed before %s when canonical ownership no longer matches', async (_name, call) => {
    await expect(call()).rejects.toThrow('booking_scope_mismatch');
    expect(mocks.getBookingOpsRecord).not.toHaveBeenCalled();
    expect(mocks.supabaseFrom).not.toHaveBeenCalled();
    expect(mocks.recomputeGuestLegalReadiness).not.toHaveBeenCalled();
    expect(mocks.ensurePhysicalTasks).not.toHaveBeenCalled();
    expect(mocks.guardBookingCommunicationDraft).not.toHaveBeenCalled();
  });
});
