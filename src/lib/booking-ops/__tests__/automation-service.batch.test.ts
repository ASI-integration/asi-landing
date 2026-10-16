import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingOpsRecord } from '../types';

const { rpc, update, leases } = vi.hoisted(() => ({
  rpc: vi.fn(), update: vi.fn(), leases: new Map<string, string>(),
}));
vi.mock('@/lib/supabase', () => ({ supabase: {
  rpc,
  from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { automation_paused: false }, error: null }) }) }) }),
} }));
vi.mock('../repository', () => ({ updateBookingOpsRecord: update }));
vi.mock('../decision-engine', () => ({
  evaluateBookingOpsAutomation: () => ({ nextAction: 'review', automationState: 'ready' }),
  buildBookingOpsAutomationPatch: () => ({ guestCount: 2 }),
}));
import { runBookingOpsAutomationBatch } from '../automation-service';

const record = (id: string) => ({ id, accountId: 'account-a', propertyId: 'property-a', opsStatus: 'created' }) as BookingOpsRecord;
beforeEach(() => {
  vi.clearAllMocks(); leases.clear();
  rpc.mockImplementation(async (name: string, args: { p_booking: string; p_token: string }) => {
    if (name === 'g0_begin_automation') { leases.set(args.p_booking, args.p_token); return { data: true, error: null }; }
    if (name === 'g0_end_automation' && leases.get(args.p_booking) === args.p_token) {
      leases.delete(args.p_booking); return { data: true, error: null };
    }
    return { data: false, error: { message: 'unexpected_rpc' } };
  });
  update.mockImplementation(async (id: string) => ({ ok: true, record: record(id) }));
});

describe('automation batch partial outcomes', () => {
  it('preserves success and reports a sanitized failed identity while retaining its lease', async () => {
    update.mockImplementation(async (id: string) => {
      if (id === 'failed') throw new Error('private provider diagnostic');
      return { ok: true, record: record(id) };
    });
    const result = await runBookingOpsAutomationBatch([record('success'), record('failed')]);
    expect(result.records.map((item) => item.id)).toEqual(['success']);
    expect(result.failures).toEqual([{ recordId: 'failed', code: 'manual_reconciliation_required' }]);
    expect(JSON.stringify(result)).not.toContain('private provider diagnostic');
    expect(leases.has('success')).toBe(false);
    expect(leases.has('failed')).toBe(true);
    expect(rpc.mock.calls.filter(([name]) => name === 'g0_end_automation').map(([, args]) => args.p_booking)).toEqual(['success']);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('reports all failures without retrying or releasing their leases', async () => {
    update.mockResolvedValue({ ok: false, error: 'unknown_write_acknowledgement' });
    const result = await runBookingOpsAutomationBatch([record('first'), record('second')]);
    expect(result.records).toEqual([]);
    expect(result.failures).toEqual([
      { recordId: 'first', code: 'manual_reconciliation_required' },
      { recordId: 'second', code: 'manual_reconciliation_required' },
    ]);
    expect([...leases.keys()].sort()).toEqual(['first', 'second']);
    expect(rpc.mock.calls.every(([name]) => name === 'g0_begin_automation')).toBe(true);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('returns empty outcomes without database calls for an empty batch', async () => {
    expect(await runBookingOpsAutomationBatch([])).toEqual({ records: [], failures: [] });
    expect(rpc).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
