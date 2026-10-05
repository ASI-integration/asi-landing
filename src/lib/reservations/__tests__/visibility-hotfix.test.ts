import { beforeEach, describe, expect, it, vi } from 'vitest';
import { belongsToReservationAccount, isReservationVisibleInView, reservationEmptyMessages, type ReservationViewRow } from '../views';

const now = new Date('2026-07-12T12:00:00.000Z');
const row = (status: string, id = status): ReservationViewRow => ({ id, normalized_status: status, check_in_at: '2026-07-11T12:00:00.000Z', check_out_at: '2026-07-14T12:00:00.000Z' });
const visible = (record: ReservationViewRow, view: Parameters<typeof isReservationVisibleInView>[0]['view'], activeHoldIds = new Set<string>(), conflictReservationIds = new Set<string>()) => isReservationVisibleInView({ row: record, view, now, activeHoldIds, conflictReservationIds });

describe('reservation dashboard views', () => {
  it('excludes null-account legacy rows and reservations from another account', () => {
    expect(belongsToReservationAccount({ account_id: null }, 'account-a')).toBe(false);
    expect(belongsToReservationAccount({ account_id: 'account-b' }, 'account-a')).toBe(false);
    expect(belongsToReservationAccount({ account_id: 'account-a' }, 'account-a')).toBe(true);
  });
  it('shows inquiries and only active temporary holds', () => {
    expect(visible(row('inquiry'), 'inquiries')).toBe(true);
    expect(visible(row('temporary_hold', 'active-hold'), 'inquiries', new Set(['active-hold']))).toBe(true);
    expect(visible(row('temporary_hold', 'expired-hold'), 'inquiries')).toBe(false);
  });

  it('shows every status in all', () => {
    for (const status of ['inquiry', 'temporary_hold', 'confirmed', 'checked_in', 'checked_out', 'cancelled']) expect(visible(row(status), 'all')).toBe(true);
  });

  it('uses open reconciliation reservation ids for conflicts', () => {
    expect(visible(row('confirmed', 'conflicted'), 'conflicts', new Set(), new Set(['conflicted']))).toBe(true);
    expect(visible(row('confirmed', 'clear'), 'conflicts', new Set(), new Set(['conflicted']))).toBe(false);
  });

  it('implements upcoming and active lifecycle rules', () => {
    expect(visible(row('confirmed'), 'active')).toBe(true);
    expect(visible(row('checked_in'), 'active')).toBe(true);
    expect(visible(row('inquiry'), 'upcoming')).toBe(false);
    expect(visible(row('cancelled'), 'upcoming')).toBe(false);
  });

  it('provides the contextual empty state for every tab', () => {
    expect(reservationEmptyMessages).toEqual({ upcoming: 'Нет предстоящих броней', active: 'Сейчас никто не проживает', inquiries: 'Нет запросов или удержаний', conflicts: 'Нет нерешённых конфликтов', cancelled: 'Нет отменённых броней', all: 'Броней пока нет' });
  });
});

const state = vi.hoisted(() => ({
  records: [
    { id: 'legacy-1', account_id: null as string | null, asi_reference: 'ASI-100001', property_label: 'Тестовый объект', property_id: 'p1', check_in_at: '2026-08-01', check_out_at: '2026-08-03' },
    { id: 'other-account', account_id: 'account-b', asi_reference: 'ASI-200001', property_label: 'Другой объект', property_id: 'p2', check_in_at: '2026-08-01', check_out_at: '2026-08-03' },
  ],
  properties: [
    { id: 'p1', account_id: 'account-a' },
    { id: 'p2', account_id: 'account-b' },
  ],
  audits: [] as unknown[],
  messages: 0,
}));

vi.mock('@/lib/reservations/ledger', () => ({ auditReservationMutation: vi.fn(async (entry) => { state.audits.push(entry); }) }));
vi.mock('@/lib/supabase', () => ({ supabase: { from(table: string) {
  if (table === 'accounts') {
    return { select: () => ({ eq: (_key: string, id: string) => ({ maybeSingle: async () => ({ data: id === 'account-a' ? { id } : null, error: null }) }) }) };
  }
  if (table === 'properties') {
    return {
      select: () => {
        let rows = [...state.properties];
        const query = {
          eq: (key: string, value: string) => {
            rows = rows.filter((item) => item[key as keyof typeof item] === value);
            return query;
          },
          maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
          then: (resolve: (value: { data: typeof rows; error: null }) => unknown) => resolve({ data: rows, error: null }),
        };
        return query;
      },
    };
  }
  if (table !== 'booking_ops_records') throw new Error(`unexpected table ${table}`);
  return {
    select: () => {
      let rows = [...state.records];
      const query = {
        is: (key: string, value: unknown) => {
          rows = rows.filter((item) => item[key as keyof typeof item] === value);
          return query;
        },
        in: (key: string, values: unknown[]) => {
          rows = rows.filter((item) => values.includes(item[key as keyof typeof item]));
          return query;
        },
        order: async () => ({ data: rows, error: null }),
      };
      return query;
    },
    update: (patch: { account_id: string }) => {
      let rows = [...state.records];
      const query = {
        eq: (key: string, value: unknown) => {
          rows = rows.filter((item) => item[key as keyof typeof item] === value);
          return query;
        },
        is: (key: string, value: unknown) => {
          rows = rows.filter((item) => item[key as keyof typeof item] === value);
          return query;
        },
        select: () => query,
        maybeSingle: async () => {
          const item = rows[0];
          if (!item) return { data: null, error: null };
          item.account_id = patch.account_id;
          return { data: { id: item.id }, error: null };
        },
      };
      return query;
    },
  };
} } }));

describe('legacy reservation bootstrap', () => {
  beforeEach(() => { state.records[0].account_id = null; state.audits.length = 0; state.messages = 0; });

  it('dry-run returns only safe null-account rows and changes no data', async () => {
    const { previewLegacyReservations } = await import('../legacy-bootstrap');
    const preview = await previewLegacyReservations('account-a');
    expect(preview).toEqual([{ id: 'legacy-1', asiReference: 'ASI-100001', propertyId: 'p1', propertyLabel: 'Тестовый объект', checkIn: '2026-08-01', checkOut: '2026-08-03' }]);
    expect(state.records[0].account_id).toBeNull();
    expect(JSON.stringify(preview)).not.toContain('guest');
  });

  it('requires confirmation and assigns only selected eligible records with an audit', async () => {
    const { assignLegacyReservations } = await import('../legacy-bootstrap');
    await expect(assignLegacyReservations({ targetAccountId: 'account-a', selectedIds: ['legacy-1'], actorId: 'admin', confirm: false })).rejects.toThrow('explicit_confirmation_required');
    const result = await assignLegacyReservations({ targetAccountId: 'account-a', selectedIds: ['legacy-1', 'other-account'], actorId: 'admin', confirm: true });
    expect(result).toEqual({ requested: 2, eligible: 1, assigned: 1, alreadyAssignedOrUnavailable: 1 });
    expect(state.records.find((item) => item.id === 'other-account')?.account_id).toBe('account-b');
    expect(state.audits).toHaveLength(1);
    expect(state.messages).toBe(0);
  });

  it('is idempotent on retry', async () => {
    const { assignLegacyReservations } = await import('../legacy-bootstrap');
    await assignLegacyReservations({ targetAccountId: 'account-a', selectedIds: ['legacy-1'], actorId: 'admin', confirm: true });
    const retry = await assignLegacyReservations({ targetAccountId: 'account-a', selectedIds: ['legacy-1'], actorId: 'admin', confirm: true });
    expect(retry.assigned).toBe(0);
    expect(state.audits).toHaveLength(1);
  });
});
