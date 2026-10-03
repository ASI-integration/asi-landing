import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  scope: vi.fn(), from: vi.fn(), event: vi.fn(), sync: vi.fn(),
}));
vi.mock('../repository', () => ({ requireBookingOpsRecordScope: mocks.scope }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }));
vi.mock('../events', () => ({ recordBookingOpsEvent: mocks.event, recordBookingOpsReadinessEvent: vi.fn() }));
vi.mock('../lifecycle', () => ({ syncLifecycleFromTask: mocks.sync }));
vi.mock('../communication-orchestrator', () => ({ syncBookingOpsCommunications: vi.fn() }));
import { createBookingOpsTask, updateBookingOpsTask } from '../tasks';
const scope = { accountId: 'account-a', propertyId: 'property-a' };
const input = { bookingOpsRecordId: 'ops-a', bookingId: 'booking-a',
  taskType: 'unit_ready_confirmation' as const, title: 'review' };
const writes: string[] = [];
let existing: Record<string, unknown> | null;
let onRead: (() => void) | undefined;
function query() {
  let value = existing;
  const q = {
    select: () => q, eq: () => q, in: () => q, order: () => q, limit: () => q,
    maybeSingle: async () => { onRead?.(); return { data: value, error: null }; },
    single: async () => ({ data: value, error: null }),
    insert: (row: Record<string, unknown>) => { writes.push('insert'); value = row; return q; },
    update: (patch: Record<string, unknown>) => { writes.push('update'); value = { ...existing, ...patch }; return q; },
  };
  return q;
}
describe('operator task mutation execution scope', () => {
  beforeEach(() => {
    vi.resetAllMocks(); writes.length = 0; existing = null; onRead = undefined;
    mocks.scope.mockResolvedValue({ id: 'ops-a', bookingId: 'canonical-source-booking', ...scope });
    mocks.from.mockImplementation(query);
  });
  it.each([
    ['creation', () => createBookingOpsTask(input, { expectedScope: scope })],
    ['update', () => updateBookingOpsTask('ops-a', 'task-a', { status: 'completed' }, { expectedScope: scope })],
  ])('rejects mismatched %s before repository access', async (_name, call) => {
    mocks.scope.mockRejectedValue(new Error('booking_scope_mismatch'));
    await expect(call()).rejects.toThrow('booking_scope_mismatch');
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.event).not.toHaveBeenCalled();
  });
  it('binds source booking to the final canonical record rather than caller input', async () => {
    mocks.scope.mockResolvedValueOnce({ id: 'ops-a', bookingId: 'old-source', ...scope });
    mocks.scope.mockResolvedValueOnce({ id: 'ops-a', bookingId: 'old-source', ...scope });
    const result = await createBookingOpsTask({ ...input, bookingId: 'foreign-source' }, { expectedScope: scope });
    expect(result.ok && result.task.bookingId).toBe('canonical-source-booking');
    expect(mocks.sync).toHaveBeenCalledWith(expect.objectContaining({
      bookingOpsRecordId: 'ops-a', bookingId: 'canonical-source-booking',
    }), scope);
  });
  it('rejects a corrupt duplicate source-booking link without effects', async () => {
    existing = { id: 'task-a', booking_ops_record_id: 'ops-a', booking_id: 'foreign-source', status: 'open' };
    const result = await createBookingOpsTask(input, { expectedScope: scope });
    expect(result).toEqual({ ok: false, error: 'task_booking_scope_mismatch' });
    expect(writes).toEqual([]);
    expect(mocks.event).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });
  it('reuses a canonically linked duplicate without effects', async () => {
    existing = { id: 'task-a', booking_ops_record_id: 'ops-a', booking_id: 'canonical-source-booking', status: 'open' };
    const result = await createBookingOpsTask(input, { expectedScope: scope });
    expect(result.ok && result.created).toBe(false);
    expect(writes).toEqual([]);
  });
  it('revalidates after the duplicate-task lookup before creation', async () => {
    onRead = () => mocks.scope.mockRejectedValue(new Error('booking_scope_mismatch'));
    await expect(createBookingOpsTask(input, { expectedScope: scope })).rejects.toThrow('booking_scope_mismatch');
    expect(writes).toEqual([]);
  });
  it('revalidates after existing-task read before update', async () => {
    existing = { id: 'task-a', booking_ops_record_id: 'ops-a', status: 'open' };
    onRead = () => mocks.scope.mockRejectedValue(new Error('booking_scope_mismatch'));
    await expect(updateBookingOpsTask('ops-a', 'task-a', { status: 'completed' }, { expectedScope: scope })).rejects.toThrow('booking_scope_mismatch');
    expect(writes).toEqual([]);
  });
  it.each([
    ['creation', () => createBookingOpsTask(input, { expectedScope: scope })],
    ['update', () => updateBookingOpsTask('ops-a', 'task-a', { status: 'completed' }, { expectedScope: scope })],
  ])('revalidates %s after its audit event before lifecycle sync', async (_name, call) => {
    if (_name === 'update') existing = { id: 'task-a', booking_ops_record_id: 'ops-a', status: 'open' };
    mocks.event.mockImplementation(async () => {
      mocks.scope.mockRejectedValue(new Error('booking_scope_mismatch'));
    });
    await expect(call()).rejects.toThrow('booking_scope_mismatch');
    expect(writes).toHaveLength(1);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
});
