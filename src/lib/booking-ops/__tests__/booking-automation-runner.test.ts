import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  rows: {} as Record<string, Array<Record<string, unknown>>>,
  rpc: vi.fn(), from: vi.fn(), mutations: 0,
}));

vi.mock('@/lib/supabase', () => {
  class Query implements PromiseLike<{ data: Array<Record<string, unknown>>; error: null }> {
    private filters: Array<[string, unknown]> = [];
    constructor(private table: string) {}
    select() { return this; }
    eq(column: string, value: unknown) { this.filters.push([column, value]); return this; }
    in() { return this; }
    update() { state.mutations += 1; return this; }
    insert() { state.mutations += 1; return this; }
    private data() { return (state.rows[this.table] ?? []).filter((row) => this.filters.every(([key, value]) => row[key] === value)); }
    maybeSingle() { const data = this.data(); return Promise.resolve({ data: data[0] ?? null, error: null }); }
    then<TResult1 = { data: Array<Record<string, unknown>>; error: null }, TResult2 = never>(onfulfilled?: ((value: { data: Array<Record<string, unknown>>; error: null }) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null) { return Promise.resolve({ data: this.data(), error: null }).then(onfulfilled, onrejected); }
  }
  state.from.mockImplementation((table: string) => new Query(table));
  return { supabase: { from: state.from, rpc: state.rpc } };
});

import { runBookingOpsAutomationForBooking } from '../booking-automation-runner';

const ID = '11111111-1111-4111-8111-111111111111';
function baseRows() {
  state.rows = {
    booking_ops_records: [{ id: ID, account_id: 'account-1', property_id: 'property-1', document_required: false, contract_required: false, deposit_required: false, mvd_required: false, metadata: {} }],
    accounts: [{ id: 'account-1' }], properties: [{ id: 'property-1', account_id: 'account-1' }], tg_property_knowledge: [],
    booking_lifecycle_gates: [{ id: 'gate-1', booking_id: ID, gate_key: 'booking_received', status: 'completed', metadata: {} }, { id: 'gate-2', booking_id: ID, gate_key: 'property_ready', status: 'completed', metadata: {} }],
    booking_ops_guest_intake_sessions: [{ id: 'intake-1', booking_ops_record_id: ID, intake_status: 'completed', missing_fields: [] }],
    booking_ops_tasks: [], booking_guest_documents: [], booking_contracts: [], booking_deposits: [], booking_mvd_reports: [], booking_ops_communication_intents: [],
    booking_checkin_execution: [{ booking_id: ID, instructions_status: 'sent', arrival_status: 'confirmed' }],
    booking_cleaning_tasks: [{ booking_id: ID, status: 'verified' }], booking_linen_tasks: [{ booking_id: ID, status: 'verified' }], booking_supplies_tasks: [{ booking_id: ID, status: 'verified' }],
    booking_maintenance_tickets: [], booking_physical_readiness: [{ booking_id: ID, status: 'approved', metadata: {} }], booking_ops_alerts: [],
  };
}

describe('runBookingOpsAutomationForBooking boundaries', () => {
  beforeEach(() => { vi.clearAllMocks(); state.mutations = 0; baseRows(); state.rpc.mockResolvedValue({ data: false, error: null }); });

  it('rejects cross-account execution before acquiring a lock', async () => {
    await expect(runBookingOpsAutomationForBooking({ bookingId: ID, expectedAccountId: 'account-2', dryRun: true })).rejects.toThrow('booking_account_mismatch');
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('dryRun performs zero writes and creates no lock, event, alert, draft, or task', async () => {
    const result = await runBookingOpsAutomationForBooking({ bookingId: ID, expectedAccountId: 'account-1', dryRun: true });
    expect(result.lockAcquired).toBe(false);
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.mutations).toBe(0);
  });

  it('a per-booking lock prevents concurrent duplicate execution', async () => {
    const result = await runBookingOpsAutomationForBooking({ bookingId: ID, expectedAccountId: 'account-1' });
    expect(state.rpc).toHaveBeenCalledWith('acquire_booking_ops_alert_run_lock', expect.objectContaining({ p_lock_scope: `booking-automation:${ID}` }));
    expect(result.lockAcquired).toBe(false);
    expect(result.executed).toHaveLength(0);
  });

  it('honors maxActions in a targeted dry run', async () => {
    state.rows.booking_lifecycle_gates = [];
    state.rows.booking_ops_guest_intake_sessions = [];
    const result = await runBookingOpsAutomationForBooking({ bookingId: ID, dryRun: true, maxActions: 1 });
    expect(result.planned.filter((item) => item.disposition === 'execute')).toHaveLength(1);
  });

  it('normal completed state produces no exception handoff', async () => {
    const result = await runBookingOpsAutomationForBooking({ bookingId: ID, dryRun: true });
    expect(result.planned).toEqual([expect.objectContaining({ disposition: 'completed', reasonCode: 'automation_complete' })]);
    expect(result.approvalsRequired).toHaveLength(0);
    expect(result.planned.some((item) => item.disposition === 'handoff_required')).toBe(false);
  });
});
