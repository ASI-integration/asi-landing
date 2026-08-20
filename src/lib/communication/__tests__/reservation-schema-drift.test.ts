import { beforeEach, describe, expect, it, vi } from 'vitest';

const selectedColumns: string[] = [];

const reservationRow = {
  id: '11111111-2222-4333-8444-555555555555',
  property_id: 'test-prop-email-prod',
  guest_id: 'test-guest-email-prod',
  guest_name: 'ASI Email Acceptance Guest',
  check_in: '2026-08-20T12:00:00.000Z',
  check_out: '2026-08-22T12:00:00.000Z',
};

function createThenableQuery(result: { data: unknown; error: unknown }) {
  const query: Record<string, unknown> = {};
  const chain = () => query;

  query.limit = vi.fn(chain);
  query.eq = vi.fn(chain);
  query.ilike = vi.fn(chain);
  query.in = vi.fn(chain);
  query.gte = vi.fn(chain);
  query.lte = vi.fn(chain);
  query.order = vi.fn(chain);
  query.maybeSingle = vi.fn(async () => result);
  query.then = (resolve: (value: typeof result) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);

  return query;
}

const fromMock = vi.fn((table: string) => ({
  select: (columns: string) => {
    if (table === 'tg_guest_reservations') selectedColumns.push(columns);
    return createThenableQuery({ data: [reservationRow], error: null });
  },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => fromMock(table),
  },
}));

import { matchReservation } from '../reservation';

describe('reservation matcher production schema compatibility', () => {
  beforeEach(() => {
    selectedColumns.length = 0;
    fromMock.mockClear();
  });

  it('matches a recognized email guest by guest name without selecting stale listing_id', async () => {
    const result = await matchReservation({
      guestName: 'ASI Email Acceptance Guest',
    });

    expect(result).toMatchObject({
      status: 'matched',
      reservationId: reservationRow.id,
      propertyId: reservationRow.property_id,
      guestId: reservationRow.guest_id,
      guestName: reservationRow.guest_name,
    });
    expect(result.listingId).toBeUndefined();
    expect(selectedColumns).toEqual([
      'id, property_id, guest_id, guest_name, check_in, check_out',
    ]);
    expect(selectedColumns.some(columns => columns.includes('listing_id'))).toBe(false);
  });
});
