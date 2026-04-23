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

async function runOne(params: {
  chatId: number;
  update_id: number;
  text: string;
  db: any;
}) {
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

describe('TASK7 guest↔reservation↔property matching (Telegram operational intake)', () => {
  beforeEach(() => __resetAutonomousSessionStoreForTests());
  afterEach(() => __resetAutonomousSessionStoreForTests());

  it('A. John Smith today 18:00 at Nevsky 24, door code does not work', async () => {
    const chatId = 7001;
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
    ]);

    const { r, reply } = await runOne({
      chatId,
      update_id: 1,
      text: 'Hi, guest John Smith is checking in today at 18:00 at Nevsky 24. He says the door code does not work.',
      db,
    });

    expect(r.hit.category).toBe('access_issue');
    expect((r.hit.extractedFacts as any).match_confidence).toMatch(/high|medium/);
    expect(r.hit.finalAction).toBe('escalate_urgent');
    expect(reply).toMatch(/urgent/i);
    expect(reply).toMatch(/John Smith|Nevsky 24/);
  });

  it('B. Anna Petrova late checkout tomorrow until 13:00', async () => {
    const chatId = 7002;
    const db = makeDb([
      {
        when: q => q._table === 'tg_guest_reservations' && q._filters.some((f: any) => f.op === 'ilike' && f.col === 'guest_name'),
        respond: { data: [{ id: 'res_ap', property_id: 'prop_lit', guest_name: 'Anna Petrova', check_in: '2026-04-22T14:00:00.000Z', check_out: '2026-04-25T11:00:00.000Z' }], error: null },
      },
    ]);

    const { r, reply } = await runOne({
      chatId,
      update_id: 2,
      text: 'Hello. Guest Anna Petrova asks for late checkout tomorrow until 13:00.',
      db,
    });

    expect(r.hit.category).toBe('late_checkout');
    expect(r.hit.finalAction === 'clarify' || r.hit.finalAction === 'reply').toBe(true);
    // One targeted clarification max — never generic fallback.
    expect(reply).not.toMatch(/Please share one key detail/i);
  });

  it('C. No heating, very cold (property unknown) → urgent + one best question or escalation', async () => {
    const chatId = 7003;
    const db = makeDb([]);
    const { r, reply } = await runOne({
      chatId,
      update_id: 3,
      text: 'Guest says there is no heating in the apartment and it is very cold.',
      db,
    });

    expect(r.hit.category).toBe('no_heating');
    expect(r.hit.finalAction === 'escalate_urgent' || r.hit.finalAction === 'clarify').toBe(true);
    if (r.hit.finalAction === 'clarify') {
      expect(reply).toMatch(/Which property|property/i);
    }
  });

  it('D. Wi‑Fi for John Smith at Nevsky 24 → grounded reply', async () => {
    const chatId = 7004;
    const db = makeDb([
      {
        when: q => q._table === 'tg_property_knowledge' && q._filters.some((f: any) => f.op === 'ilike' && f.col === 'location'),
        respond: { data: [{ property_id: 'prop_nev', location: 'Nevsky 24' }], error: null },
      },
    ]);

    const { r, reply } = await runOne({
      chatId,
      update_id: 4,
      text: 'Can you check Wi‑Fi for John Smith at Nevsky 24?',
      db,
    });

    expect(r.hit.category).toBe('wifi_issue');
    expect(reply).toMatch(/Wi/i);
    expect(reply).toMatch(/Nevsky 24|John Smith/);
    expect(reply).not.toMatch(/Which property is this for\?/i);
  });

  it('E. Guest at Liteyny 12 cannot enter → urgent + property/address matching attempt', async () => {
    const chatId = 7005;
    const db = makeDb([
      {
        when: q => q._table === 'tg_property_knowledge' && q._filters.some((f: any) => f.op === 'ilike' && f.col === 'location'),
        respond: { data: [{ property_id: 'prop_lit', location: 'Liteyny 12' }], error: null },
      },
    ]);

    const { r, reply } = await runOne({
      chatId,
      update_id: 5,
      text: 'Guest at Liteyny 12 cannot enter.',
      db,
    });

    expect(r.hit.category).toBe('access_issue');
    expect(r.hit.finalAction).toBe('escalate_urgent');
    expect((r.hit.extractedFacts as any).property_match_status).toBe('matched');
    expect(reply).toMatch(/Liteyny 12/);
  });
});

