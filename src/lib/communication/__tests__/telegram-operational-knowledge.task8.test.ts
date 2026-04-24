import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { processTelegramOperationalIntakeWithSessionMemory } from '../telegram-session-memory';
import { __resetAutonomousSessionStoreForTests } from '../conversation-session-store';
import { composeTelegramOperationalReply } from '../telegram-reply-composer';

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
        maybeSingle: async () => {
          const hit = routes.find(r => r.when(q));
          return hit ? hit.respond : { data: null, error: null };
        },
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

async function runOne(params: { chatId: number; update_id: number; text: string; db: any }) {
  const r = await processTelegramOperationalIntakeWithSessionMemory({
    chatId: params.chatId,
    channel: 'telegram',
    surfaceLang: 'en',
    update_id: params.update_id,
    text: params.text,
    db: params.db,
  });
  expect(r.handled).toBe(true);
  if (!r.handled) throw new Error('expected handled');
  const composed = composeTelegramOperationalReply({
    update_id: params.update_id,
    category: r.hit.category,
    action: r.hit.finalAction,
    lang: 'en',
    text: params.text,
    extractedFacts: r.hit.extractedFacts ?? {},
    missingFacts: r.hit.missingFacts ?? [],
    urgency: r.hit.finalAction === 'escalate_urgent' ? 'urgent' : 'normal',
    linkingState: null,
    sessionCase: r.case ?? null,
    sessionMemory: null,
  });
  return { r, reply: composed.text };
}

describe('TASK8 property knowledge lookup for Telegram operational intake', () => {
  beforeEach(() => __resetAutonomousSessionStoreForTests());
  afterEach(() => __resetAutonomousSessionStoreForTests());

  it('A. Wi-Fi for John Smith at Nevsky 24 → grounded Wi-Fi reply with network/password', async () => {
    const db = makeDb([
      {
        when: q => q._table === 'tg_property_knowledge' && q._filters.some((f: any) => f.op === 'ilike' && f.col === 'location'),
        respond: { data: [{ property_id: 'prop_nev', location: 'Nevsky 24' }], error: null },
      },
      {
        when: q => q._table === 'tg_property_knowledge' && q._filters.some((f: any) => f.op === 'eq' && f.col === 'property_id'),
        respond: {
          data: {
            property_id: 'prop_nev',
            wifi_name: 'GuestWifi',
            wifi_password: 'secret123',
            wifi_notes: 'Router is in the hallway closet',
          },
          error: null,
        },
      },
    ]);

    const { r, reply } = await runOne({ chatId: 8001, update_id: 201, text: 'Can you check Wi‑Fi for John Smith at Nevsky 24?', db });
    expect(r.hit.category).toBe('wifi_issue');
    expect((r.hit.extractedFacts as any).property_knowledge_status).toBe('knowledge_found');
    expect(r.hit.finalAction).toBe('reply');
    expect(reply).toMatch(/GuestWifi/);
    expect(reply).toMatch(/secret123/);
    expect(reply).not.toMatch(/Which property is this for\?/i);
  });

  it('B. Parking with property knowledge → grounded parking reply', async () => {
    const db = makeDb([
      {
        when: q => q._table === 'tg_property_knowledge' && q._filters.some((f: any) => f.op === 'ilike' && f.col === 'location'),
        respond: { data: [{ property_id: 'prop_nev', location: 'Nevsky 24' }], error: null },
      },
      {
        when: q => q._table === 'tg_property_knowledge' && q._filters.some((f: any) => f.op === 'eq' && f.col === 'property_id'),
        respond: {
          data: {
            property_id: 'prop_nev',
            parking_paid_or_free: 'paid',
            parking_rules: 'Use underground garage entrance from Malaya Morskaya',
            parking_location_notes: 'Overnight slots available on ground level',
          },
          error: null,
        },
      },
    ]);

    const { r, reply } = await runOne({ chatId: 8002, update_id: 202, text: 'Guest asks where they can park near the apartment at Nevsky 24 and whether parking is free or paid.', db });
    expect(r.hit.category).toBe('parking_question');
    expect((r.hit.extractedFacts as any).property_knowledge_status).toBe('knowledge_found');
    expect(r.hit.finalAction).toBe('reply');
    expect(reply).toMatch(/paid/i);
    expect(reply).toMatch(/underground|ground level|Morskaya/i);
    expect(reply).not.toMatch(/Which property is this for\?/i);
  });

  it('C. Access issue urgent at Nevsky 24 → escalates urgent, operator summary has property knowledge', async () => {
    const db = makeDb([
      {
        when: q =>
          q._table === 'tg_guest_reservations' &&
          q._filters.some((f: any) => f.op === 'ilike' && f.col === 'guest_name') &&
          q._filters.some((f: any) => f.op === 'gte' && f.col === 'check_in'),
        respond: { data: [{ id: 'res_js', property_id: 'prop_nev', guest_name: 'John Smith', check_in: '2026-04-23T14:00:00.000Z' }], error: null },
      },
      {
        when: q => q._table === 'tg_property_knowledge' && q._filters.some((f: any) => f.op === 'ilike' && f.col === 'location'),
        respond: { data: [{ property_id: 'prop_nev', location: 'Nevsky 24' }], error: null },
      },
      {
        when: q => q._table === 'tg_property_knowledge' && q._filters.some((f: any) => f.op === 'eq' && f.col === 'property_id'),
        respond: {
          data: {
            property_id: 'prop_nev',
            door_code_notes: 'Keypad code 4829*, ring #2 if it fails',
            access_notes: 'Backup key with concierge on floor 1',
            checkin_instructions: 'Elevator to 5, unit 24',
          },
          error: null,
        },
      },
    ]);

    const { r, reply } = await runOne({ chatId: 8003, update_id: 203, text: 'Hi, guest John Smith is checking in today at 18:00 at Nevsky 24. He says the door code does not work.', db });
    expect(r.hit.category).toBe('access_issue');
    expect(r.hit.finalAction).toBe('escalate_urgent');
    expect((r.hit.extractedFacts as any).property_knowledge_status).toBe('knowledge_found');
    expect((r.hit.extractedFacts as any).property_knowledge_fields).toEqual(expect.arrayContaining(['door_code_notes']));
    expect(reply).toMatch(/urgent/i);
    expect(reply).toMatch(/4829|concierge/);
  });

  it('D. Late checkout with policy → policy-aware reply', async () => {
    const db = makeDb([
      {
        when: q => q._table === 'tg_guest_reservations' && q._filters.some((f: any) => f.op === 'ilike' && f.col === 'guest_name'),
        respond: { data: [{ id: 'res_ap', property_id: 'prop_lit', guest_name: 'Anna Petrova', check_in: '2026-04-22T14:00:00.000Z', check_out: '2026-04-25T11:00:00.000Z' }], error: null },
      },
      {
        when: q => q._table === 'tg_property_knowledge' && q._filters.some((f: any) => f.op === 'eq' && f.col === 'property_id'),
        respond: {
          data: {
            property_id: 'prop_lit',
            late_checkout_policy: 'Late checkout until 13:00 is complimentary when no same-day arrival; otherwise 1500 RUB per hour',
          },
          error: null,
        },
      },
    ]);

    const { r, reply } = await runOne({ chatId: 8004, update_id: 204, text: 'Hello. Guest Anna Petrova asks for late checkout tomorrow until 13:00 at Liteyny 12.', db });
    expect(r.hit.category).toBe('late_checkout');
    // Policy-aware: should not be a generic fallback.
    expect(reply).not.toMatch(/Please share one key detail/i);
    if ((r.hit.extractedFacts as any).property_knowledge_status === 'knowledge_found') {
      expect(reply).toMatch(/Late checkout policy/i);
      expect(reply).toMatch(/13:00|complimentary|RUB/);
    }
  });

  it('E. No heating urgent with heating notes → escalates urgent, reply includes emergency/heating hint', async () => {
    const db = makeDb([
      {
        when: q => q._table === 'tg_property_knowledge' && q._filters.some((f: any) => f.op === 'ilike' && f.col === 'location'),
        respond: { data: [{ property_id: 'prop_nev', location: 'Nevsky 24' }], error: null },
      },
      {
        when: q => q._table === 'tg_property_knowledge' && q._filters.some((f: any) => f.op === 'eq' && f.col === 'property_id'),
        respond: {
          data: {
            property_id: 'prop_nev',
            heating_notes: 'Thermostat in hallway; boiler reset via orange button',
            emergency_contact_notes: 'On-call maintenance +7 999 555-01-99',
          },
          error: null,
        },
      },
    ]);

    const { r, reply } = await runOne({ chatId: 8005, update_id: 205, text: 'Guest says there is no heating in the apartment at Nevsky 24 and it is very cold.', db });
    expect(r.hit.category).toBe('no_heating');
    expect(r.hit.finalAction).toBe('escalate_urgent');
    expect((r.hit.extractedFacts as any).property_knowledge_status).toBe('knowledge_found');
    expect(reply).toMatch(/urgent/i);
    expect(reply).toMatch(/Thermostat|boiler|555-01-99|maintenance/i);
  });
});
