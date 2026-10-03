import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  updateBookingOpsRecord: vi.fn(),
  evaluateBookingOpsAutomation: vi.fn(),
  buildBookingOpsAutomationPatch: vi.fn(),
}));

vi.mock('../repository', () => ({
  updateBookingOpsRecord: mocks.updateBookingOpsRecord,
}));

vi.mock('../decision-engine', () => ({
  evaluateBookingOpsAutomation: mocks.evaluateBookingOpsAutomation,
  buildBookingOpsAutomationPatch: mocks.buildBookingOpsAutomationPatch,
}));

import { runBookingOpsAutomation } from '../automation-service';
import type { BookingOpsRecord } from '../types';

const decision = {
  recommendedOpsStatus: 'ready_for_checkin',
  nextAction: 'mark_ready_for_checkin',
  automationState: 'auto_ready',
  canAutoPerform: true,
  needsOperatorAction: false,
  blockers: [],
  reason: 'ready',
};

function record(overrides: Partial<BookingOpsRecord> = {}): BookingOpsRecord {
  return {
    id: 'booking-1',
    accountId: 'account-a',
    propertyId: 'property-a',
    opsStatus: 'checkin_instructions_ready',
    ...overrides,
  } as BookingOpsRecord;
}

describe('runBookingOpsAutomation scope boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.evaluateBookingOpsAutomation.mockReturnValue(decision);
    mocks.buildBookingOpsAutomationPatch.mockReturnValue({ opsStatus: 'ready_for_checkin' });
    mocks.updateBookingOpsRecord.mockImplementation(async (_id, patch) => ({
      ok: true,
      record: record(patch),
    }));
  });

  it('guards canonical account/property automation writes with the record scope', async () => {
    await runBookingOpsAutomation(record());

    expect(mocks.updateBookingOpsRecord).toHaveBeenCalledWith(
      'booking-1',
      { opsStatus: 'ready_for_checkin' },
      {
        actorType: 'system',
        expectedScope: { accountId: 'account-a', propertyId: 'property-a' },
      },
    );
  });

  it('keeps legacy/accountless automation on the existing fallback path', async () => {
    await runBookingOpsAutomation(record({ accountId: null, propertyId: null }));

    expect(mocks.updateBookingOpsRecord).toHaveBeenCalledWith(
      'booking-1',
      { opsStatus: 'ready_for_checkin' },
      { actorType: 'system' },
    );
  });

  it('fails closed when the canonical scope no longer matches', async () => {
    mocks.updateBookingOpsRecord.mockResolvedValueOnce({ ok: false, error: 'scope_mismatch' });

    const result = await runBookingOpsAutomation(record());

    expect(result.automation?.automationState).toBe('needs_operator_attention');
    expect(result.automation?.canAutoPerform).toBe(false);
    expect(result.automation?.needsOperatorAction).toBe(true);
  });
});
