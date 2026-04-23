import { describe, it, expect } from 'vitest';
import { linkReservationOrPropertyDeterministicV1 } from '../reservation-property-linking';

type DbResponse = { data: any; error: any };

function makeDb(routes: Array<{ when: (q: any) => boolean; respond: DbResponse }>) {
  const db = {
    from: (table: string) => {
      const q: any = {
        _table: table,
        _filters: [] as Array<{ op: string; col: string; val: any }>,
        select: () => q,
        ilike: (col: string, val: any) => {
          q._filters.push({ op: 'ilike', col, val });
          return q;
        },
        eq: (col: string, val: any) => {
          q._filters.push({ op: 'eq', col, val });
          return q;
        },
        in: (col: string, val: any) => {
          q._filters.push({ op: 'in', col, val });
          return q;
        },
        gte: (col: string, val: any) => {
          q._filters.push({ op: 'gte', col, val });
          return q;
        },
        lte: (col: string, val: any) => {
          q._filters.push({ op: 'lte', col, val });
          return q;
        },
        order: () => q,
        limit: () => q,
        maybeSingle: async () => ({ data: null, error: { message: 'not used' } }),
        then: (resolve: any, reject: any) => {
          try {
            const hit = routes.find(r => r.when(q));
            const out = hit ? hit.respond : { data: [], error: null };
            return Promise.resolve(out).then(resolve, reject);
          } catch (e) {
            return Promise.reject(e).then(resolve, reject);
          }
        },
      };
      return q;
    },
  };
  return db;
}

describe('linkReservationOrPropertyDeterministicV1', () => {
  it('address present → linked_to_property (unique property match)', async () => {
    const db = makeDb([
      {
        when: (q) => q._table === 'tg_property_knowledge' && q._filters.some((f: any) => f.op === 'ilike' && f.col === 'location'),
        respond: { data: [{ property_id: 'prop_1', location: 'Nevsky 24' }], error: null },
      },
      {
        when: (q) => q._table === 'tg_guest_reservations',
        respond: { data: [], error: null },
      },
    ]);

    const res = await linkReservationOrPropertyDeterministicV1({
      text: 'Issue at Nevsky 24',
      surfaceLang: 'en',
      update_id: 10,
      propertyLocation: 'Nevsky 24',
      db: db as any,
    });

    expect(res.outcome).toBe('linked_to_property');
    if (res.outcome === 'linked_to_property') {
      expect(res.propertyId).toBe('prop_1');
      expect(res.state.outcome).toBe('linked_to_property');
    }
  });

  it('guest name present → linked_to_reservation (unique reservation match)', async () => {
    const db = makeDb([
      {
        when: (q) => q._table === 'tg_property_knowledge',
        respond: { data: [], error: null },
      },
      {
        when: (q) => q._table === 'tg_guest_reservations' && q._filters.some((f: any) => f.op === 'ilike' && f.col === 'guest_name'),
        respond: { data: [{ id: 'res_1', property_id: 'prop_A', guest_name: 'John Doe' }], error: null },
      },
    ]);

    const res = await linkReservationOrPropertyDeterministicV1({
      text: 'Guest John Doe has a question',
      surfaceLang: 'en',
      update_id: 11,
      guestName: 'John Doe',
      db: db as any,
    });

    expect(res.outcome).toBe('linked_to_reservation');
    if (res.outcome === 'linked_to_reservation') {
      expect(res.reservationId).toBe('res_1');
      expect(res.propertyId).toBe('prop_A');
      expect(res.state.outcome).toBe('linked_to_reservation');
    }
  });

  it('date/time present (today check-in token) + guest name → linked_to_reservation', async () => {
    const db = makeDb([
      {
        when: (q) => q._table === 'tg_property_knowledge',
        respond: { data: [], error: null },
      },
      {
        when: (q) =>
          q._table === 'tg_guest_reservations' &&
          q._filters.some((f: any) => f.op === 'ilike' && f.col === 'guest_name') &&
          q._filters.some((f: any) => f.op === 'gte' && f.col === 'check_in') &&
          q._filters.some((f: any) => f.op === 'lte' && f.col === 'check_in'),
        respond: { data: [{ id: 'res_today', property_id: 'prop_T', guest_name: 'Jane Smith' }], error: null },
      },
    ]);

    const res = await linkReservationOrPropertyDeterministicV1({
      text: 'Guest Jane Smith — today check-in',
      surfaceLang: 'en',
      update_id: 12,
      guestName: 'Jane Smith',
      db: db as any,
    });

    expect(res.outcome).toBe('linked_to_reservation');
  });

  it('one missing fact → unresolved_needs_one_fact (asks one short question)', async () => {
    // Have guest + timing, missing property/address.
    const db = makeDb([
      { when: (q) => q._table === 'tg_property_knowledge', respond: { data: [], error: null } },
      { when: (q) => q._table === 'tg_guest_reservations', respond: { data: [], error: null } },
    ]);

    const res = await linkReservationOrPropertyDeterministicV1({
      text: 'Guest John Doe — today check-in',
      surfaceLang: 'en',
      update_id: 13,
      guestName: 'John Doe',
      db: db as any,
    });

    expect(res.outcome).toBe('unresolved_needs_one_fact');
    if (res.outcome === 'unresolved_needs_one_fact') {
      expect(res.question).toMatch(/Which property/i);
      expect(res.state.missing_fact_for_linking).toBe('property_or_address');
    }
  });

  it('unresolved case → unresolved_escalate (no guessing)', async () => {
    const db = makeDb([
      {
        when: (q) => q._table === 'tg_property_knowledge',
        respond: { data: [{ property_id: 'prop_1' }, { property_id: 'prop_2' }], error: null },
      },
    ]);

    const res = await linkReservationOrPropertyDeterministicV1({
      text: 'Issue at Nevsky',
      surfaceLang: 'en',
      update_id: 14,
      propertyLocation: 'Nevsky',
      db: db as any,
    });

    expect(res.outcome).toBe('unresolved_escalate');
    expect(res.state.outcome).toBe('unresolved_escalate');
    expect(res.state.candidate_matches.length).toBeGreaterThan(0);
  });
});

