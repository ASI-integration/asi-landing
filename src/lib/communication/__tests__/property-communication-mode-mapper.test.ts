import { describe, expect, it } from 'vitest';
import { lookup_property_by_booking } from '../telegram-booking-object-memory';

describe('property communication mode mapper', () => {
  it('preserves manual mode from tg_property_knowledge while loading checkout knowledge', async () => {
    const rowsByTable: Record<string, Array<Record<string, unknown>>> = {
      object_knowledge_entries: [],
      tg_property_knowledge: [
        {
          property_id: 'test-prop-tg-live',
          check_out_time: '12:00',
          communication_autopilot: 'manual',
          active: true,
        },
      ],
    };

    const db = {
      from: (table: string) => {
        const q: any = {
          _filters: [] as Array<{ col: string; val: unknown }>,
          _inFilters: [] as Array<{ col: string; vals: unknown[] }>,
          _limit: null as number | null,
          select: () => q,
          eq: (col: string, val: unknown) => {
            q._filters.push({ col, val });
            return q;
          },
          in: (col: string, vals: unknown[]) => {
            q._inFilters.push({ col, vals });
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
            for (const filter of q._inFilters) {
              rows = rows.filter((row) => filter.vals.includes(row[filter.col]));
            }
            resolve({ data: rows.slice(0, q._limit ?? rows.length) });
          },
        };
        return q;
      },
    };

    const property = await lookup_property_by_booking({
      booking: {
        booking_id: 'ASI-EMAIL-TEST-20260820',
        reservation_id: '7e57b9e2-5a39-4c8b-8b0f-2a6c6d5e0201',
        guest_name: 'Тестовый Гость',
        guest_phone: null,
        telegram_chat_id: null,
        object_id: 'test-prop-tg-live',
        check_in_date: '2026-08-19',
        check_out_date: '2026-08-22',
        status: 'confirmed',
        access_verified: false,
      },
      db,
    });

    expect(property).toMatchObject({
      object_id: 'test-prop-tg-live',
      checkout_time: '12:00',
      communication_autopilot: 'manual',
    });
  });
});
