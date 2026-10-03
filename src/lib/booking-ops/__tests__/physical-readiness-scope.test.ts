import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  scope: vi.fn(), from: vi.fn(), createTask: vi.fn(), updateTask: vi.fn(),
  block: vi.fn(), complete: vi.fn(), progress: vi.fn(), audit: vi.fn(), checkin: vi.fn(),
}));
vi.mock('../repository', () => ({ getBookingOpsRecord: vi.fn(), requireBookingOpsRecordScope: mocks.scope }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }));
vi.mock('../tasks', () => ({ createBookingOpsTask: mocks.createTask, updateBookingOpsTask: mocks.updateTask }));
vi.mock('../lifecycle', () => ({ blockGate: mocks.block, completeGate: mocks.complete, markGateInProgress: mocks.progress }));
vi.mock('../lifecycle-autopilot-service', () => ({
  durableEventId: (...parts: string[]) => parts.join(':'), recordProcessedBookingAuditEvent: mocks.audit,
}));
vi.mock('../pre-checkin-control-center', () => ({ recomputeBookingCheckinReadiness: mocks.checkin }));
import * as physical from '../physical-readiness-execution';
const id = '11111111-1111-4111-8111-111111111111';
const ticket = '22222222-2222-4222-8222-222222222222';
const scope = { accountId: 'account-a', propertyId: 'property-a' };
const record = { id, bookingId: 'reservation-a', ...scope };
const writes: Array<{ table: string; patch: Record<string, unknown> }> = [];
const rows: Record<string, Record<string, unknown>[]> = {};
let afterWrite: ((table: string) => void) | undefined;
function query(table: string) {
  let result = rows[table] ?? [], value: Record<string, unknown> | undefined;
  const write = (patch: Record<string, unknown>) => {
    writes.push({ table, patch }); value = patch;
    if (afterWrite) afterWrite(table);
    return q;
  };
  const q = {
    select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q,
    maybeSingle: async () => ({ data: value ?? result[0] ?? null, error: null }),
    single: async () => ({ data: value ?? result[0] ?? null, error: null }),
    insert: write, upsert: write, update: (patch: Record<string, unknown>) => {
      for (const row of result) Object.assign(row, patch);
      return write(patch);
    },
    then: (resolve: (value: unknown) => void) => resolve({ data: value ?? result, error: null }),
  };
  return q;
}
const actions = [
  ['initialize', () => physical.ensurePhysicalTasks(id, scope)],
  ['recompute', () => physical.recomputePhysicalReadiness(id, scope)],
  ['cleaning', () => physical.updateCleaningTask(id, { status: 'assigned', assignedToName: 'operator' }, scope)],
  ['linen', () => physical.updateLinenTask(id, { status: 'delivered' }, scope)],
  ['supplies', () => physical.updateSuppliesTask(id, { status: 'verified' }, scope)],
  ['maintenance creation', () => physical.createMaintenanceTicket(id, { title: 'review' }, scope)],
  ['maintenance update', () => physical.updateMaintenanceTicket(id, { ticketId: ticket, status: 'resolved' }, scope)],
  ['coordination draft', () => physical.createPhysicalCoordinationDraft(id, { taskType: 'cleaning' }, scope)],
  ['approval', () => physical.approveFinalPhysicalReadiness(id, 'operator', scope)],
] as const;
function operationallyReady() {
  for (const table of ['booking_cleaning_tasks', 'booking_linen_tasks', 'booking_supplies_tasks']) rows[table][0].status = 'verified';
  rows.booking_maintenance_tickets = [];
}
describe('physical readiness canonical mutation scope', () => {
  beforeEach(() => {
    vi.resetAllMocks(); writes.length = 0; afterWrite = undefined;
    for (const key of Object.keys(rows)) delete rows[key];
    for (const table of ['booking_cleaning_tasks', 'booking_linen_tasks', 'booking_supplies_tasks']) rows[table] = [{ id: ticket, booking_id: id, status: 'pending' }];
    rows.booking_maintenance_tickets = [{ id: ticket, booking_id: id, status: 'open' }];
    rows.booking_physical_readiness = [{ id: ticket, booking_id: id, status: 'not_ready' }];
    rows.booking_ops_tasks = [];
    mocks.scope.mockResolvedValue(record); mocks.from.mockImplementation(query);
    mocks.createTask.mockResolvedValue({ ok: true, task: { id: ticket, status: 'open' } });
    mocks.updateTask.mockResolvedValue({ ok: true });
  });
  it.each(actions)('rejects %s on canonical account/property mismatch before writes', async (_name, call) => {
    mocks.scope.mockRejectedValue(new Error('booking_scope_mismatch'));
    await expect(call()).rejects.toThrow('booking_scope_mismatch');
    expect(writes).toEqual([]);
    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it.each(actions.slice(0, 8))('revalidates before the %s write after initial access succeeds', async (_name, call) => {
    mocks.scope.mockResolvedValueOnce(record).mockRejectedValue(new Error('booking_scope_mismatch'));
    await expect(call()).rejects.toThrow('booking_scope_mismatch');
    expect(writes).toEqual([]);
  });
  it('rechecks initialization between task writes', async () => {
    afterWrite = () => mocks.scope.mockRejectedValue(new Error('booking_scope_mismatch'));
    await expect(physical.ensurePhysicalTasks(id, scope)).rejects.toThrow('booking_scope_mismatch');
    expect(writes.map(write => write.table)).toEqual(['booking_cleaning_tasks']);
  });
  it('propagates scope to operator task creation and completion during approval', async () => {
    operationallyReady();
    await physical.approveFinalPhysicalReadiness(id, 'operator', scope);
    expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({ bookingOpsRecordId: id }), { expectedScope: scope });
    expect(mocks.updateTask).toHaveBeenCalledWith(id, ticket, { status: 'completed' }, { expectedScope: scope });
    expect(mocks.checkin).toHaveBeenCalledWith(id, { expectedScope: scope });
  });
  it('rejects ownership changes during operator-task closure before gate/event writes', async () => {
    rows.booking_physical_readiness[0].approved_at = '2026-10-03T12:00:00Z';
    mocks.createTask.mockImplementation(async () => {
      mocks.scope.mockRejectedValue(new Error('booking_scope_mismatch'));
      return { ok: true, task: { id: ticket } };
    });
    await expect(physical.recomputePhysicalReadiness(id, scope)).rejects.toThrow('booking_scope_mismatch');
    expect(mocks.block).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('revalidates after recompute before granting final approval', async () => {
    operationallyReady(); rows.booking_physical_readiness[0].status = 'ready_for_review';
    mocks.progress.mockImplementation(async () => {
      mocks.scope.mockRejectedValue(new Error('booking_scope_mismatch'));
    });
    await expect(physical.approveFinalPhysicalReadiness(id, 'operator', scope)).rejects.toThrow('booking_scope_mismatch');
    expect(writes.some(write => 'approved_by' in write.patch && write.patch.approved_by === 'operator')).toBe(false);
  });
  it('revalidates after approval audit before nested check-in recompute', async () => {
    operationallyReady();
    mocks.audit.mockImplementation(async event => {
      if (event.type === 'final_property_readiness_approved') mocks.scope.mockRejectedValue(new Error('booking_scope_mismatch'));
    });
    await expect(physical.approveFinalPhysicalReadiness(id, 'operator', scope)).rejects.toThrow('booking_scope_mismatch');
    expect(mocks.checkin).not.toHaveBeenCalled();
  });
});
