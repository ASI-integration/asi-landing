import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  scope: vi.fn(), get: vi.fn(), update: vi.fn(), initialize: vi.fn(),
  lifecycle: vi.fn(), complete: vi.fn(), block: vi.fn(), tasks: vi.fn(),
  legal: vi.fn(), physical: vi.fn(), from: vi.fn(), insert: vi.fn(), knowledge: vi.fn(),
}));
vi.mock('../repository', () => ({
  getBookingOpsRecord: mocks.get, requireBookingOpsRecordScope: mocks.scope,
  updateBookingOpsRecord: mocks.update, listBookingOpsRecords: vi.fn(),
}));
vi.mock('../lifecycle', () => ({
  initializeLifecycleForBooking: mocks.initialize, readLifecycleStatus: mocks.lifecycle,
  completeGate: mocks.complete, blockGate: mocks.block, adminUpdateLifecycleGate: vi.fn(),
}));
vi.mock('../tasks', () => ({ listBookingOpsTasksForRecord: mocks.tasks }));
vi.mock('../guest-legal-deposit-mvd-execution', () => ({ recomputeGuestLegalReadiness: mocks.legal }));
vi.mock('../physical-readiness-execution', () => ({ ensurePhysicalTasks: mocks.physical }));
vi.mock('../communication-auto-send-policy', () => ({ buildAutoSendDecisionMetadata: vi.fn(async () => ({})) }));
vi.mock('@/lib/communication/booking-knowledge-boundary', () => ({ guardBookingCommunicationDraft: mocks.knowledge }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }));
import { getPreCheckinStatus, recomputeBookingCheckinReadiness } from '../pre-checkin-control-center';
const id = 'ops-a', scope = { accountId: 'account-a', propertyId: 'property-a' };
const required = [
  'guest_data_completed', 'documents_verified', 'contract_signed', 'deposit_received',
  'mvd_report_submitted', 'cleaning_scheduled', 'linen_scheduled', 'inspection_scheduled',
  'property_ready', 'checkin_instructions_sent',
];
const statuses: Record<string, string> = {};
describe('physical approval nested pre-check-in scope', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    for (const key of required) statuses[key] = 'completed';
    const record = { id, guestName: 'guest', ...scope };
    mocks.scope.mockResolvedValue(record); mocks.get.mockResolvedValue(record);
    mocks.update.mockResolvedValue({ ok: true }); mocks.initialize.mockResolvedValue({ ok: true });
    mocks.tasks.mockResolvedValue({ ok: true, tasks: [] });
    mocks.lifecycle.mockImplementation(async () => ({
      ok: true, lifecycle: { bookingId: id,
        gates: required.map(gateKey => ({ gateKey, status: statuses[gateKey] })) },
    }));
    mocks.from.mockImplementation(() => {
      const q = { select: () => q, eq: () => q,
        order: async () => ({ data: [], error: null }), insert: mocks.insert };
      return q;
    });
    mocks.insert.mockResolvedValue({ error: null });
    mocks.knowledge.mockResolvedValue({ status: 'draft_ready', messageText: 'review', metadata: {} });
    mocks.legal.mockResolvedValue({ status: 'ready_for_checkin', blockers: [] });
    mocks.physical.mockResolvedValue({ status: 'approved', blockers: [], finalReady: true });
  });
  it('propagates scope through nested legal, physical and lifecycle initialization', async () => {
    await getPreCheckinStatus(id, scope);
    expect(mocks.legal).toHaveBeenCalledWith(id, { source: 'pre_checkin' }, scope);
    expect(mocks.physical).toHaveBeenCalledWith(id, scope);
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it('rejects a mismatched canonical scope before recompute side effects', async () => {
    mocks.scope.mockRejectedValue(new Error('booking_scope_mismatch'));
    await expect(recomputeBookingCheckinReadiness(id, { expectedScope: scope })).rejects.toThrow('booking_scope_mismatch');
    expect(mocks.initialize).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it('revalidates after lifecycle initialization before further work', async () => {
    mocks.initialize.mockImplementation(async () => {
      mocks.scope.mockRejectedValue(new Error('booking_scope_mismatch'));
      return { ok: true };
    });
    await expect(recomputeBookingCheckinReadiness(id, { expectedScope: scope })).rejects.toThrow('booking_scope_mismatch');
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });
  it('blocks instruction draft persistence when ownership changes during knowledge review', async () => {
    statuses.checkin_instructions_sent = 'pending';
    mocks.knowledge.mockImplementation(async () => {
      mocks.scope.mockRejectedValue(new Error('booking_scope_mismatch'));
      return { status: 'draft_ready', messageText: 'review', metadata: {} };
    });
    await expect(recomputeBookingCheckinReadiness(id, { expectedScope: scope })).rejects.toThrow('booking_scope_mismatch');
    expect(mocks.knowledge).toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.legal).not.toHaveBeenCalled();
  });
  it('revalidates after a gate write before refreshed snapshot and downstream effects', async () => {
    statuses.property_ready = 'pending';
    mocks.complete.mockImplementation(async () => {
      mocks.scope.mockRejectedValue(new Error('booking_scope_mismatch'));
    });
    await expect(recomputeBookingCheckinReadiness(id, { expectedScope: scope })).rejects.toThrow('booking_scope_mismatch');
    expect(mocks.complete).toHaveBeenCalledTimes(1);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
