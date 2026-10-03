import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  scope: vi.fn(), from: vi.fn(), update: vi.fn(), knowledge: vi.fn(),
  initialize: vi.fn(), complete: vi.fn(), block: vi.fn(), progress: vi.fn(),
}));
vi.mock('../repository', () => ({
  getBookingOpsRecord: vi.fn(), requireBookingOpsRecordScope: mocks.scope,
  updateBookingOpsRecord: mocks.update,
}));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }));
vi.mock('../lifecycle', () => ({
  initializeLifecycleForBooking: mocks.initialize, completeGate: mocks.complete,
  blockGate: mocks.block, markGateInProgress: mocks.progress,
  getLifecycleStatus: vi.fn(async () => ({ lifecycle: null })),
}));
vi.mock('../communication-auto-send-policy', () => ({
  buildAutoSendDecisionMetadata: vi.fn(async () => ({})),
}));
vi.mock('@/lib/communication/booking-knowledge-boundary', () => ({
  guardBookingCommunicationDraft: mocks.knowledge,
}));
import * as legal from '../legal-payment-autopilot';

const id = '11111111-1111-4111-8111-111111111111';
const scope = { accountId: 'account-a', propertyId: 'property-a' };
const record = { id, bookingId: 'reservation-a', ...scope };
const writes: string[] = [];
function query(table: string) {
  const q = {
    select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q,
    maybeSingle: async () => ({ data: null, error: null }),
    insert: () => { writes.push(table); return q; },
    update: () => { writes.push(table); return q; },
    upsert: () => { writes.push(table); return q; },
    then: (resolve: (value: unknown) => void) => resolve({ data: [], error: null }),
  };
  return q;
}
const mutations = [
  ['initialize', () => legal.initializeLegalPaymentForBooking(id, scope)],
  ['request documents', () => legal.requestGuestDocuments(id, ['passport'], {}, scope)],
  ['receive documents', () => legal.markDocumentsReceived(id, {}, scope)],
  ['verify documents', () => legal.verifyGuestDocuments(id, {}, scope)],
  ['reject documents', () => legal.rejectGuestDocuments(id, 'review', {}, scope)],
  ['prepare contract', () => legal.prepareContract(id, 'safe', {}, scope)],
  ['send contract marker', () => legal.markContractSent(id, {}, scope)],
  ['sign contract marker', () => legal.markContractSigned(id, {}, scope)],
  ['request deposit', () => legal.requestDeposit(id, 100, 'RUB', {}, scope)],
  ['receive deposit', () => legal.markDepositReceived(id, {}, scope)],
  ['waive deposit', () => legal.waiveDeposit(id, 'manual', {}, scope)],
  ['prepare MVD', () => legal.prepareMvdReport(id, {}, scope)],
  ['submit MVD', () => legal.markMvdReportSubmitted(id, {}, scope)],
  ['accept MVD', () => legal.markMvdReportAccepted(id, {}, scope)],
  ['recompute', () => legal.recomputePreCheckinReadiness(id, scope)],
  ['status lifecycle initialization', () => legal.getLegalPaymentStatus(id, scope)],
] as const;

describe('legal/payment execution canonical scope', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    writes.length = 0;
    mocks.scope.mockResolvedValue(record);
    mocks.from.mockImplementation(query);
    mocks.update.mockResolvedValue({ ok: true });
    mocks.knowledge.mockResolvedValue({ status: 'draft_ready', messageText: 'review', metadata: {} });
  });
  it.each(mutations)('carries scope into nested lifecycle operations for %s', async (_name, call) => {
    await call();
    expect(mocks.initialize).toHaveBeenCalled();
    for (const fn of [mocks.initialize, mocks.complete, mocks.block, mocks.progress]) {
      for (const args of fn.mock.calls) expect(args.at(-1)).toEqual(scope);
    }
  });
  it.each(mutations)('blocks %s after canonical account/property mismatch', async (_name, call) => {
    mocks.scope.mockRejectedValue(new Error('booking_scope_mismatch'));
    await expect(call()).rejects.toThrow('booking_scope_mismatch');
    expect(writes).toEqual([]);
    expect(mocks.initialize).not.toHaveBeenCalled();
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.knowledge).not.toHaveBeenCalled();
  });
  it.each([
    ['contract', () => legal.prepareContract(id, 'safe', {}, scope)],
    ['deposit', () => legal.requestDeposit(id, 100, 'RUB', {}, scope)],
    ['MVD', () => legal.prepareMvdReport(id, {}, scope)],
  ])('rechecks scope after the %s read and before upsert', async (_name, call) => {
    mocks.scope.mockResolvedValueOnce(record).mockRejectedValue(new Error('booking_scope_mismatch'));
    await expect(call()).rejects.toThrow('booking_scope_mismatch');
    expect(writes).toEqual([]);
    expect(mocks.complete).not.toHaveBeenCalled();
  });
  it('rechecks scope after lifecycle initialization before document insertion', async () => {
    mocks.initialize.mockImplementation(async () => {
      mocks.scope.mockRejectedValue(new Error('booking_scope_mismatch'));
    });
    await expect(legal.requestGuestDocuments(id, [], {}, scope)).rejects.toThrow('booking_scope_mismatch');
    expect(writes).toEqual([]);
  });
  it('carries expectedScope to the repository summary write', async () => {
    await legal.markDocumentsReceived(id, {}, scope);
    expect(mocks.update).toHaveBeenCalledWith(id, expect.any(Object), {
      actorType: 'system', expectedScope: scope,
    });
  });
  it('blocks communication persistence when ownership changes during knowledge review', async () => {
    mocks.knowledge.mockImplementation(async () => {
      mocks.scope.mockRejectedValue(new Error('booking_scope_mismatch'));
      return { status: 'draft_ready', messageText: 'review', metadata: {} };
    });
    await expect(legal.markContractSent(id, {}, scope)).rejects.toThrow('booking_scope_mismatch');
    expect(writes).toEqual(['booking_contracts']);
  });
});
