import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingOpsTask } from '../task-types';
const mocks = vi.hoisted(() => ({ scope: vi.fn(), from: vi.fn() }));
vi.mock('../repository', () => ({ requireBookingOpsRecordScope: mocks.scope }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }));
import { syncLifecycleFromTask } from '../lifecycle';
const scope = { accountId: 'account-a', propertyId: 'property-a' };
const writes: string[] = [];
let afterInit: (() => void) | undefined;
let afterGate: (() => void) | undefined;
function query(table: string) {
  let row: Record<string, unknown> = {};
  const q = {
    select: () => q, eq: () => q, order: () => q,
    upsert: (input: Record<string, unknown> | Record<string, unknown>[]) => {
      row = Array.isArray(input) ? input[0] : input;
      writes.push(table + (Array.isArray(input) ? ':init' : ':gate'));
      if (Array.isArray(input)) afterInit?.(); else afterGate?.();
      return q;
    },
    update: () => { writes.push(table + ':resolve'); return q; },
    single: async () => ({ data: row, error: null }),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
  };
  return q;
}
function task(status: BookingOpsTask['status'] = 'open', taskType: BookingOpsTask['taskType'] = 'cleaning_needed') {
  return { id: 'task-a', bookingOpsRecordId: 'ops-a', taskType, status } as BookingOpsTask;
}
describe('task lifecycle execution scope', () => {
  beforeEach(() => {
    vi.resetAllMocks(); writes.length = 0; afterInit = undefined; afterGate = undefined;
    mocks.scope.mockResolvedValue({ id: 'ops-a', ...scope });
    mocks.from.mockImplementation(query);
  });
  it.each(['open', 'in_progress', 'blocked', 'completed'] as const)('rejects mismatched %s at domain entry', async status => {
    mocks.scope.mockRejectedValue(new Error('booking_scope_mismatch'));
    await expect(syncLifecycleFromTask(task(status), scope)).rejects.toThrow('booking_scope_mismatch');
    expect(writes).toEqual([]);
  });
  it('revalidates after initialization before updating the gate', async () => {
    afterInit = () => mocks.scope.mockRejectedValue(new Error('booking_scope_mismatch'));
    await expect(syncLifecycleFromTask(task(), scope)).rejects.toThrow('booking_scope_mismatch');
    expect(writes).toEqual(['booking_lifecycle_gates:init']);
  });
  it.each(['blocked', 'completed'] as const)('revalidates before %s exception side effects', async status => {
    afterGate = () => mocks.scope.mockRejectedValue(new Error('booking_scope_mismatch'));
    await expect(syncLifecycleFromTask(task(status), scope)).rejects.toThrow('booking_scope_mismatch');
    expect(writes).toEqual(['booking_lifecycle_gates:init', 'booking_lifecycle_gates:gate']);
  });
  it.each(['maintenance_needed', 'inspection_needed'] as const)('revalidates between the two %s completion gates', async taskType => {
    mocks.scope.mockImplementation(async () => {
      if (writes.includes('booking_lifecycle_exceptions:resolve')) throw new Error('booking_scope_mismatch');
      return { id: 'ops-a', ...scope };
    });
    await expect(syncLifecycleFromTask(task('completed', taskType), scope)).rejects.toThrow('booking_scope_mismatch');
    expect(writes).toEqual(['booking_lifecycle_gates:init', 'booking_lifecycle_gates:gate', 'booking_lifecycle_exceptions:resolve']);
  });
  it('preserves the existing scoped open-task lifecycle behavior', async () => {
    await syncLifecycleFromTask(task(), scope);
    expect(writes).toEqual(['booking_lifecycle_gates:init', 'booking_lifecycle_gates:gate', 'booking_lifecycle_exceptions:resolve']);
    for (const args of mocks.scope.mock.calls) expect(args).toEqual(['ops-a', scope]);
  });
});
