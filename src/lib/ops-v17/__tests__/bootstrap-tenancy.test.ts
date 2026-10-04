import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;
const state = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  beforeBookingUpdateExecute: null as null | (() => void),
}));
vi.mock('@/lib/supabase', () => ({ supabase: { from: (table: string) => {
  let matches = (_row: Row) => true;
  let operation = 'select'; let payload: Row | Row[];
  const rows = () => state.tables[table] ?? (state.tables[table] = []);
  const execute = () => {
    if (table === 'booking_ops_records' && operation === 'update' && state.beforeBookingUpdateExecute) {
      const race = state.beforeBookingUpdateExecute;
      state.beforeBookingUpdateExecute = null;
      race();
    }
    const selected = rows().filter(matches);
    if (operation === 'update') selected.forEach((row) => Object.assign(row, payload));
    if (operation === 'insert' || operation === 'upsert') rows().push(...(Array.isArray(payload) ? payload : [payload]));
    return { data: selected, error: null };
  };
  const query = {
    select: () => query, order: () => query, limit: () => query,
    eq: (key: string, value: unknown) => {
      const previous = matches; matches = (row: Row) => previous(row) && row[key] === value; return query;
    },
    or: (filter: string) => {
      const accountId = filter.split(',')[0].replace('account_id.eq.', '');
      const previous = matches;
      matches = (row: Row) => previous(row) && (row.account_id === accountId || row.account_id == null);
      return query;
    },
    update: (value: Row) => { operation = 'update'; payload = value; return query; },
    insert: (value: Row) => { operation = 'insert'; payload = value; return query; },
    upsert: (value: Row | Row[]) => { operation = 'upsert'; payload = value; return query; },
    maybeSingle: async () => { const result = execute(); return { ...result, data: result.data[0] ?? null }; },
    then: (resolve: (value: unknown) => void) => resolve(execute()),
  };
  return query;
} } }));
import { bootstrapPilot } from '../service';
beforeEach(() => {
  state.beforeBookingUpdateExecute = null;
  const booking = (id: string, account_id: string | null, property_id: string) => ({
    id, account_id, property_id, booking_id: id, check_in_at: '2026-10-03', check_out_at: '2026-10-04',
    guest_email: 'fixture@example.invalid', ota_source: 'manual',
  });
  state.tables = {
    ops_v17_onboardings: [{ id: 'onboarding-A', account_id: 'A', data: {}, pilot_activated_at: null }],
    ops_v17_module_state: [],
    properties: [{ id: 'property-A', account_id: 'A' }, { id: 'property-B', account_id: 'B' }],
    booking_ops_records: [booking('own', 'A', 'property-A'), booking('foreign', 'B', 'property-B'), booking('unbound', null, 'property-B')],
  };
});
describe('bootstrap never adopts unknown tenant data', () => {
  it('does not link an account-owned booking to a foreign property', async () => {
    state.tables.booking_ops_records[0].property_id = 'property-B';
    const result = await bootstrapPilot({ accountId: 'A', actorId: 'admin-A', confirm: true });
    expect(result.preview.eligibleRecords).toBe(0);
    expect(result.preview.ambiguousRecords[0].missing).toContain('owned_property');
    expect(state.tables.reservation_source_links ?? []).toEqual([]);
  });
  it('fails closed when an eligible booking moves to another owned property before persistence', async () => {
    state.tables.properties.push({ id: 'property-A2', account_id: 'A' });
    state.beforeBookingUpdateExecute = () => {
      state.tables.booking_ops_records.find((row) => row.id === 'own')!.property_id = 'property-A2';
    };

    await expect(bootstrapPilot({ accountId: 'A', actorId: 'admin-A', confirm: true }))
      .rejects.toThrow('booking_property_scope_changed');

    expect(state.tables.booking_ops_records.find((row) => row.id === 'own')?.source_type).toBeUndefined();
    expect(state.tables.reservation_source_links ?? []).toEqual([]);
  });

  it('preview excludes foreign and unbound bookings', async () => {
    const result = await bootstrapPilot({ accountId: 'A', actorId: 'admin-A', confirm: false });
    expect(result.preview.inspectedRecords).toBe(1);
    expect(result.preview.eligibleRecords).toBe(1);
  });
  it('confirmation leaves foreign/unbound account and source links unchanged', async () => {
    const before = structuredClone(state.tables.booking_ops_records.filter((row) => row.id !== 'own'));
    await bootstrapPilot({ accountId: 'A', actorId: 'admin-A', confirm: true });
    expect(state.tables.booking_ops_records.filter((row) => row.id !== 'own')).toEqual(before);
    expect(state.tables.reservation_source_links.map((row) => row.booking_ops_record_id)).toEqual(['own']);
  });
});
