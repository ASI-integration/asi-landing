import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  updateBookingOpsRecord: vi.fn(),
  evaluateBookingOpsAutomation: vi.fn(),
  buildBookingOpsAutomationPatch: vi.fn(),
  requireBookingAutomationRunning: vi.fn(),
  withBookingAutomationLease: vi.fn(),
}));

vi.mock('../automation-pause', () => ({
  requireBookingAutomationRunning: mocks.requireBookingAutomationRunning,
  withBookingAutomationLease: mocks.withBookingAutomationLease,
}));

vi.mock('../repository', () => ({
  updateBookingOpsRecord: mocks.updateBookingOpsRecord,
}));

vi.mock('../decision-engine', () => ({
  evaluateBookingOpsAutomation: mocks.evaluateBookingOpsAutomation,
  buildBookingOpsAutomationPatch: mocks.buildBookingOpsAutomationPatch,
}));

import { intakeBookingOpsAutomationRequest, runBookingOpsAutomation } from '../automation-service';
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
    mocks.requireBookingAutomationRunning.mockResolvedValue(undefined);
    mocks.withBookingAutomationLease.mockImplementation((_id, execute) => execute());
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

    await expect(runBookingOpsAutomation(record())).rejects.toThrow('scope_mismatch');
  });
});

describe('source-only booking operations request intake', () => {
  const request = { requestId: 'request-1', accountId: 'account-a', propertyId: 'property-a' };
  const scope = { accountId: 'account-a', propertyId: 'property-a' };

  beforeEach(() => vi.clearAllMocks());

  // Every intake case must stay outside the persistence/execution boundary.
  afterEach(() => {
    expect(mocks.updateBookingOpsRecord).not.toHaveBeenCalled();
    expect(mocks.withBookingAutomationLease).not.toHaveBeenCalled();
    expect(mocks.requireBookingAutomationRunning).not.toHaveBeenCalled();
    expect(mocks.evaluateBookingOpsAutomation).not.toHaveBeenCalled();
    expect(mocks.buildBookingOpsAutomationPatch).not.toHaveBeenCalled();
  });

  it('accepts a scoped request as source-only without mutating inputs', () => {
    const input = Object.freeze({ ...request, requestId: ' request-1 ' });
    expect(intakeBookingOpsAutomationRequest(input, Object.freeze(scope), Object.freeze([])))
      .toEqual({ sourceOnly: true, accepted: true, request });
    expect(input.requestId).toBe(' request-1 ');
  });

  it.each([
    { ...scope, propertyId: 'property-b' },
    { ...scope, accountId: 'account-b' },
    { ...scope, propertyId: '' },
    { ...scope, accountId: '' },
  ])('rejects an operator outside the exact account/property: %j', (operatorScope) => {
    expect(intakeBookingOpsAutomationRequest(request, operatorScope, []))
      .toEqual({ sourceOnly: true, accepted: false, code: 'scope_mismatch' });
  });

  it('rejects duplicate unacknowledged work including normalized identifiers', () => {
    const work = Object.freeze({ ...request, requestId: ' request-1 ', acknowledged: false });
    expect(intakeBookingOpsAutomationRequest(request, scope, Object.freeze([work])))
      .toEqual({ sourceOnly: true, accepted: false, code: 'duplicate_unacknowledged' });
    expect(work.acknowledged).toBe(false);
  });

  it('checks scope before duplicate state', () => {
    expect(intakeBookingOpsAutomationRequest(request, { ...scope, propertyId: 'property-b' }, [
      { ...request, acknowledged: false },
    ])).toEqual({ sourceOnly: true, accepted: false, code: 'scope_mismatch' });
  });

  it.each([
    { ...request, acknowledged: true },
    { ...request, requestId: 'request-2', acknowledged: false },
    { ...request, propertyId: 'property-b', acknowledged: false },
    { ...request, accountId: 'account-b', acknowledged: false },
  ])('does not confuse acknowledged or unrelated work with a duplicate: %j', (work) => {
    expect(intakeBookingOpsAutomationRequest(request, scope, [work]))
      .toEqual({ sourceOnly: true, accepted: true, request });
  });

  it.each([
    { ...request, requestId: ' ' },
    { ...request, accountId: '' },
    { ...request, propertyId: ' ' },
    { ...request, accountId: 'legacy' },
  ])('rejects incomplete or legacy identity: %j', (input) => {
    expect(intakeBookingOpsAutomationRequest(input, scope, []))
      .toEqual({ sourceOnly: true, accepted: false, code: 'invalid_request' });
  });
});
