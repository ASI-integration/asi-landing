import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  scope: vi.fn(), from: vi.fn(), update: vi.fn(), availability: vi.fn(),
  initialize: vi.fn(), complete: vi.fn(), progress: vi.fn(), block: vi.fn(), skip: vi.fn(),
}));
vi.mock('../repository', () => ({
  getBookingOpsRecord: vi.fn(), requireBookingOpsRecordScope: mocks.scope,
  updateBookingOpsRecord: mocks.update,
}));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }));
vi.mock('../availability-overbooking-protection', () => ({ checkBookingOverbookingRisk: mocks.availability }));
vi.mock('../lifecycle', () => ({
  initializeLifecycleForBooking: mocks.initialize, completeGate: mocks.complete,
  markGateInProgress: mocks.progress, blockGate: mocks.block, skipGate: mocks.skip,
}));
import * as legal from '../guest-legal-deposit-mvd-execution';
const id = '11111111-1111-4111-8111-111111111111';
const scope = { accountId: 'account-a', propertyId: 'property-a' };
const record = { id, bookingId: 'reservation-a', ...scope };
const writes: string[] = [];
function query(table: string) {
  let payload: Record<string, unknown> = {};
  const q = {
    select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q,
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: payload, error: null }),
    insert: (value: Record<string, unknown>) => { writes.push(table); payload = value; return q; },
    update: (value: Record<string, unknown>) => { writes.push(table); payload = value; return q; },
    upsert: (value: Record<string, unknown>) => { writes.push(table); payload = value; return q; },
    then: (resolve: (value: unknown) => void) => resolve({ data: [], error: null }),
  };
  return q;
}
const entries = [
  ['initialize', () => legal.initializeGuestLegalExecution(id, {}, scope)],
  ['recompute', () => legal.recomputeGuestLegalReadiness(id, {}, scope)],
  ['request documents', () => legal.requestGuestDocumentsDraft(id, {}, scope)],
  ['receive documents', () => legal.recordGuestDocumentsReceived(id, {}, {}, scope)],
  ['review documents', () => legal.markGuestDocumentsNeedsReview(id, 'review', {}, scope)],
  ['verify documents', () => legal.markGuestDocumentsVerifiedManual(id, {}, scope)],
  ['contract draft', () => legal.createContractDraft(id, {}, scope)],
  ['contract signed', () => legal.markContractSignedManual(id, {}, scope)],
  ['deposit draft', () => legal.createDepositRequestDraft(id, {}, scope)],
  ['deposit paid', () => legal.markDepositPaidManual(id, {}, scope)],
  ['deposit waived', () => legal.markDepositWaivedManual(id, 'review', {}, scope)],
  ['MVD draft', () => legal.createMvdDraft(id, {}, scope)],
  ['MVD not required', () => legal.markMvdNotRequired(id, 'review', {}, scope)],
  ['MVD submitted', () => legal.markMvdSubmittedManual(id, {}, scope)],
  ['MVD accepted', () => legal.markMvdAcceptedManual(id, {}, scope)],
  ['block flow', () => legal.blockGuestLegalFlow(id, 'review', {}, scope)],
  ['note', () => legal.addGuestLegalNote(id, 'review', {}, scope)],
] as const;
describe('guest legal execution expected scope', () => {
  beforeEach(() => {
    vi.resetAllMocks(); writes.length = 0;
    mocks.scope.mockResolvedValue(record); mocks.from.mockImplementation(query);
    mocks.update.mockResolvedValue({ ok: true });
    mocks.availability.mockResolvedValue({ status: 'no_conflict' });
  });
  it.each(entries)('rejects %s when canonical scope has changed', async (_name, call) => {
    mocks.scope.mockRejectedValue(new Error('booking_scope_mismatch'));
    await expect(call()).rejects.toThrow('booking_scope_mismatch');
    expect(writes).toEqual([]);
    expect(mocks.availability).not.toHaveBeenCalled();
    expect(mocks.initialize).not.toHaveBeenCalled();
  });
  it.each([
    ['initialization', () => legal.initializeGuestLegalExecution(id, {}, scope)],
    ['documents', () => legal.requestGuestDocumentsDraft(id, {}, scope)],
    ['contract', () => legal.createContractDraft(id, {}, scope)],
    ['deposit', () => legal.createDepositRequestDraft(id, {}, scope)],
    ['MVD', () => legal.createMvdDraft(id, {}, scope)],
  ])('revalidates after %s reads before persistence', async (_name, call) => {
    mocks.scope.mockResolvedValueOnce(record).mockRejectedValue(new Error('booking_scope_mismatch'));
    await expect(call()).rejects.toThrow('booking_scope_mismatch');
    expect(writes).toEqual([]);
  });
  it('keeps availability account-scoped and rejects ownership change during its check', async () => {
    mocks.availability.mockImplementation(async () => {
      mocks.scope.mockRejectedValue(new Error('booking_scope_mismatch'));
      return { status: 'no_conflict' };
    });
    await expect(legal.recomputeGuestLegalReadiness(id, {}, scope)).rejects.toThrow('booking_scope_mismatch');
    expect(mocks.availability).toHaveBeenCalledWith(id, { checkType: 'manual_review', accountId: scope.accountId });
    expect(writes).toEqual([]);
  });
  it('revalidates between lifecycle gate writes and stops downstream summary/events', async () => {
    mocks.progress.mockImplementation(async () => {
      mocks.scope.mockRejectedValue(new Error('booking_scope_mismatch'));
    });
    await expect(legal.recomputeGuestLegalReadiness(id, {}, scope)).rejects.toThrow('booking_scope_mismatch');
    expect(mocks.progress).toHaveBeenCalledTimes(1);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(writes).toEqual(['booking_guest_legal_readiness']);
  });
  it('carries scope through summary synchronization', async () => {
    await legal.recomputeGuestLegalReadiness(id, {}, scope);
    expect(mocks.update).toHaveBeenCalledWith(id, expect.any(Object), { actorType: 'system', expectedScope: scope });
    expect(writes).toEqual(['booking_guest_legal_readiness', 'booking_legal_execution_events']);
  });
  it('revalidates after summary synchronization before emitting its audit event', async () => {
    mocks.update.mockImplementation(async () => {
      mocks.scope.mockRejectedValue(new Error('booking_scope_mismatch'));
      return { ok: true };
    });
    await expect(legal.recomputeGuestLegalReadiness(id, {}, scope)).rejects.toThrow('booking_scope_mismatch');
    expect(writes).toEqual(['booking_guest_legal_readiness']);
  });
});
