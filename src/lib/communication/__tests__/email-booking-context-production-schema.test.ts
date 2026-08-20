import { describe, expect, it } from 'vitest';
import { lookup_booking_by_email } from '../telegram-booking-object-memory';

describe('email booking context production schema', () => {
  it('resolves a reservation directly by tg_guest_reservations.email without tg_guest_identities', async () => {
    const rowsByTable: Record<string, Array<Record<string, unknown>>> = {
      tg_guest_identities: [],
      tg_guest_reservations: [
        {
          id: '7e57b9e2-5a39-4c8b-8b0f-2a6c6d5e0201',
          booking_id: 'ASI-EMAIL-TEST-20260820',
          property_id: 'test-prop-tg-live',
          guest_id: 'test-guest-tg-live',
          guest_name: 'Тестовый Гость',
          email: 'project.ayfaar@gmail.com',
          status: 'confirmed',
          check_in: '2026-08-19T19:26:52Z',
          check_out: '2026-08-22T19:26:52Z',
        },
      ],
    };

    const db = {
      from: (table: string) => {
        const q: any = {
          _filters: [] as Array<{ col: string; val: unknown }>,
          _limit: null as number | null,
          select: () => q,
          eq: (col: string, val: unknown) => {
            q._filters.push({ col, val });
            return q;
          },
          order: () => q,
          limit: (n: number) => {
            q._limit = n;
            return q;
          },
          then: (resolve: (value: unknown) => void) => {
            let rows = [...(rowsByTable[table] ?? [])];
            for (const filter of q._filters) {
              rows = rows.filter((row) => row[filter.col] === filter.val);
            }
            resolve({ data: rows.slice(0, q._limit ?? rows.length) });
          },
        };
        return q;
      },
    };

    const booking = await lookup_booking_by_email({
      email: 'Project.Ayfaar@gmail.com',
      db,
    });

    expect(booking).toMatchObject({
      booking_id: 'ASI-EMAIL-TEST-20260820',
      reservation_id: '7e57b9e2-5a39-4c8b-8b0f-2a6c6d5e0201',
      object_id: 'test-prop-tg-live',
      guest_name: 'Тестовый Гость',
      status: 'confirmed',
    });
  });
});
