import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

const { auditReservationMutation } = vi.hoisted(() => ({
  auditReservationMutation: vi.fn(),
}));

const state = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  beforeBookingUpdateExecute: null as null | (() => void),
}));

vi.mock('@/lib/reservations/ledger', () => ({ auditReservationMutation }));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from(table: string) {
      let matches = (_row: Row) => true;
      let operation: 'select' | 'update' = 'select';
      let patch: Row = {};
      const rows = () => state.tables[table] ?? (state.tables[table] = []);
      const execute = () => {
        if (table === 'booking_ops_records' && operation === 'update' && state.beforeBookingUpdateExecute) {
          const race = state.beforeBookingUpdateExecute;
          state.beforeBookingUpdateExecute = null;
          race();
        }
        const selected = rows().filter(matches);
        if (operation === 'update') selected.forEach((row) => Object.assign(row, patch));
        return { data: selected, error: null };
      };
      const query = {
        select: () => query,
        order: () => query,
        eq: (key: string, value: unknown) => {
          const previous = matches;
          matches = (row: Row) => previous(row) && row[key] === value;
          return query;
        },
        is: (key: string, value: unknown) => {
          const previous = matches;
          matches = (row: Row) => previous(row) && row[key] === value;
          return query;
        },
        in: (key: string, values: unknown[]) => {
          const previous = matches;
          matches = (row: Row) => previous(row) && values.includes(row[key]);
          return query;
        },
        update: (value: Row) => {
          operation = 'update';
          patch = value;
          return query;
        },
        maybeSingle: async () => {
          const result = execute();
          return { ...result, data: result.data[0] ?? null };
        },
        then: (resolve: (value: { data: Row[]; error: null }) => void) => resolve(execute()),
      };
      return query;
    },
  },
}));

import { assignLegacyReservations, previewLegacyReservations } from '../legacy-bootstrap';

beforeEach(() => {
  vi.clearAllMocks();
  state.beforeBookingUpdateExecute = null;
  state.tables = {
    accounts: [{ id: 'A' }],
    properties: [
      { id: 'prop-a', account_id: 'A' },
      { id: 'prop-b', account_id: 'B' },
    ],
    booking_ops_records: [
      { id: 'legacy-a', account_id: null, property_id: 'prop-a', asi_reference: 'ASI-A', check_in_at: '2026-10-10', check_out_at: '2026-10-12' },
      { id: 'legacy-b', account_id: null, property_id: 'prop-b', asi_reference: 'ASI-B', check_in_at: '2026-10-10', check_out_at: '2026-10-12' },
      { id: 'legacy-unbound', account_id: null, property_id: null, asi_reference: 'ASI-U', check_in_at: '2026-10-10', check_out_at: '2026-10-12' },
    ],
  };
  auditReservationMutation.mockResolvedValue(undefined);
});

describe('legacy reservation account adoption scope', () => {
  it('previews only account-null reservations bound to target-owned properties', async () => {
    const preview = await previewLegacyReservations('A');

    expect(preview.map((row) => row.id)).toEqual(['legacy-a']);
    expect(preview[0]).toEqual(expect.objectContaining({ propertyId: 'prop-a' }));
  });

  it('assigns only target-owned property records and leaves foreign/unbound rows untouched', async () => {
    const result = await assignLegacyReservations({
      targetAccountId: 'A',
      selectedIds: ['legacy-a', 'legacy-b', 'legacy-unbound'],
      actorId: 'admin-A',
      confirm: true,
    });

    expect(result).toEqual({
      requested: 3,
      eligible: 1,
      assigned: 1,
      alreadyAssignedOrUnavailable: 2,
    });
    expect(state.tables.booking_ops_records.find((row) => row.id === 'legacy-a')?.account_id).toBe('A');
    expect(state.tables.booking_ops_records.find((row) => row.id === 'legacy-b')?.account_id).toBeNull();
    expect(state.tables.booking_ops_records.find((row) => row.id === 'legacy-unbound')?.account_id).toBeNull();
    expect(auditReservationMutation).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the legacy record changes property after preview', async () => {
    state.beforeBookingUpdateExecute = () => {
      state.tables.booking_ops_records.find((row) => row.id === 'legacy-a')!.property_id = 'prop-b';
    };

    const result = await assignLegacyReservations({
      targetAccountId: 'A',
      selectedIds: ['legacy-a'],
      actorId: 'admin-A',
      confirm: true,
    });

    expect(result.assigned).toBe(0);
    expect(state.tables.booking_ops_records.find((row) => row.id === 'legacy-a')?.account_id).toBeNull();
    expect(auditReservationMutation).not.toHaveBeenCalled();
  });
});
