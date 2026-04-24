import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { processTelegramOperationalIntakeWithSessionMemory } from '../telegram-session-memory';
import { matchTelegramOperationalEntitiesV1 } from '../telegram-operational-matching';
import { __resetAutonomousSessionStoreForTests } from '../conversation-session-store';

type DbResponse = { data: any; error: any };

function makeDb(routes: Array<{ when: (q: any) => boolean; respond: DbResponse }>) {
  return {
    from: (table: string) => {
      const q: any = {
        _table: table,
        _filters: [] as Array<{ op: string; col: string; val: any }>,
        select: () => q,
        ilike: (col: string, val: any) => { q._filters.push({ op: 'ilike', col, val }); return q; },
        eq: (col: string, val: any) => { q._filters.push({ op: 'eq', col, val }); return q; },
        in: (col: string, val: any) => { q._filters.push({ op: 'in', col, val }); return q; },
        gte: (col: string, val: any) => { q._filters.push({ op: 'gte', col, val }); return q; },
        lte: (col: string, val: any) => { q._filters.push({ op: 'lte', col, val }); return q; },
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
}

describe('TASK9 reservation-aware matching (Telegram)', () => {
  beforeEach(() => __resetAutonomousSessionStoreForTests());
  afterEach(() => __resetAutonomousSessionStoreForTests());

  // A. Guest says "Wi-Fi не работает" WITHOUT re-stating the address, but session already has property.
  it('A. no address + active session property → reuses session property (no re-ask)', async () => {
    const chatId = 99001;

    // First turn: explicit property so session gets populated.
    const dbTurn1 = makeDb([
      {
        when: q => q._table === 'tg_property_knowledge' && q._filters.some((f: any) => f.op === 'ilike' && f.col === 'location'),
        respond: { data: [{ property_id: 'prop_nevsky_24', location: 'Невский 24' }], error: null },
      },
    ]);
    const r1 = await processTelegramOperationalIntakeWithSessionMemory({
      chatId, channel: 'telegram', surfaceLang: 'ru', update_id: 1000,
      text: 'Здравствуйте. Я не могу подключиться к Wi-Fi в Невском 24. Можете помочь?',
      db: dbTurn1 as any,
    });
    expect(r1.handled).toBe(true);
    if (!r1.handled) throw new Error('turn1 not handled');
    expect((r1.hit.extractedFacts as any).matched_property_id).toBe('prop_nevsky_24');

    // Second turn: guest follows up without mentioning the address.
    const dbTurn2 = makeDb([
      // Property knowledge returns nothing (no property_hint this turn).
      { when: q => q._table === 'tg_property_knowledge', respond: { data: [], error: null } },
      // Reservations table should NOT be hit — session fallback wins earlier.
      { when: q => q._table === 'tg_guest_reservations', respond: { data: [], error: null } },
      { when: q => q._table === 'tg_guest_identities', respond: { data: [], error: null } },
    ]);
    const r2 = await processTelegramOperationalIntakeWithSessionMemory({
      chatId, channel: 'telegram', surfaceLang: 'ru', update_id: 1001,
      text: 'Wi-Fi всё ещё не работает, помогите пожалуйста.',
      db: dbTurn2 as any,
    });
    expect(r2.handled).toBe(true);
    if (!r2.handled) throw new Error('turn2 not handled');
    const facts2 = r2.hit.extractedFacts as any;
    expect(facts2.matched_property_id).toBe('prop_nevsky_24');
    expect(facts2.match_confidence).toBe('high_confidence_match');
    expect(facts2.session_property_match?.property_id).toBe('prop_nevsky_24');
    // Bot should NOT ask "which property".
    expect(r2.hit.reply).not.toMatch(/Для какого объекта|which property/i);
  });

  // B. Guest says door code not working WITHOUT restating address, reservation match exists by chat_id.
  it('B. no address + no session + chat_id has active reservation → matches reservation', async () => {
    const chatId = 99002;
    const db = makeDb([
      { when: q => q._table === 'tg_property_knowledge', respond: { data: [], error: null } },
      // Identity lookup returns empty (unknown identity mapping).
      { when: q => q._table === 'tg_guest_identities' && q._filters.some((f: any) => f.op === 'eq' && f.col === 'telegram_chat_id'), respond: { data: [], error: null } },
      // Direct chat_id → active reservation.
      {
        when: q =>
          q._table === 'tg_guest_reservations' &&
          q._filters.some((f: any) => f.op === 'eq' && f.col === 'chat_id') &&
          q._filters.some((f: any) => f.op === 'lte' && f.col === 'check_in'),
        respond: {
          data: [{ id: 'res_chat_active', property_id: 'prop_door', guest_name: 'Иван Петров', check_in: '2026-04-20', check_out: '2026-04-30', chat_id: chatId }],
          error: null,
        },
      },
    ]);

    const result = await matchTelegramOperationalEntitiesV1({
      surfaceLang: 'ru',
      update_id: 2000,
      scenario: 'access_issue',
      extracted_facts: { issue_type: 'access_issue', property_hint: null, guest_name: null } as any,
      chat_id: chatId,
      session_context: null,
      db: db as any,
    });

    expect(result.match_confidence).toBe('high_confidence_match');
    expect(result.matched_reservation_id).toBe('res_chat_active');
    expect(result.matched_property?.property_id).toBe('prop_door');
    expect(result.reservation_match?.source).toBe('chat_history');
    expect(result.candidate_reservations.length).toBe(1);
    expect(result.clarification_required).toBe(false);
  });

  // C. Two reservations by chat_id → bot asks ONE clarification.
  it('C. multiple reservations for chat_id → single targeted clarification', async () => {
    const chatId = 99003;
    const db = makeDb([
      { when: q => q._table === 'tg_property_knowledge', respond: { data: [], error: null } },
      { when: q => q._table === 'tg_guest_identities', respond: { data: [], error: null } },
      {
        when: q =>
          q._table === 'tg_guest_reservations' &&
          q._filters.some((f: any) => f.op === 'eq' && f.col === 'chat_id') &&
          q._filters.some((f: any) => f.op === 'lte' && f.col === 'check_in'),
        respond: {
          data: [
            { id: 'res_A', property_id: 'prop_A', guest_name: 'Иван Петров', check_in: '2026-04-22', check_out: '2026-04-30', chat_id: chatId },
            { id: 'res_B', property_id: 'prop_B', guest_name: 'Иван Петров', check_in: '2026-04-23', check_out: '2026-04-27', chat_id: chatId },
          ],
          error: null,
        },
      },
    ]);

    const result = await matchTelegramOperationalEntitiesV1({
      surfaceLang: 'en',
      update_id: 3000,
      scenario: 'wifi_issue',
      extracted_facts: { issue_type: 'wifi_issue', property_hint: null, guest_name: null } as any,
      chat_id: chatId,
      session_context: null,
      db: db as any,
    });

    expect(result.reservation_match_status).toBe('ambiguous');
    expect(result.match_confidence).toBe('low_confidence_match');
    expect(result.matched_reservation_id).toBeNull();
    expect(result.clarification_required).toBe(true);
    expect(result.candidate_reservations.length).toBe(2);
    expect(result.suggested_clarification_question).toMatch(/multiple reservations/i);
    // Exactly one question, not repeated.
    const qMatches = (result.suggested_clarification_question ?? '').match(/\?/g);
    expect(qMatches?.length).toBe(1);
  });

  // D. Unknown guest, no session, no chat_id reservations → asks property/address.
  it('D. unknown chat, no reservations, no hint → asks property/address', async () => {
    const chatId = 99004;
    const db = makeDb([
      { when: q => q._table === 'tg_property_knowledge', respond: { data: [], error: null } },
      { when: q => q._table === 'tg_guest_identities', respond: { data: [], error: null } },
      { when: q => q._table === 'tg_guest_reservations', respond: { data: [], error: null } },
    ]);

    const result = await matchTelegramOperationalEntitiesV1({
      surfaceLang: 'en',
      update_id: 4000,
      scenario: 'wifi_issue',
      extracted_facts: { issue_type: 'wifi_issue', property_hint: null, guest_name: null } as any,
      chat_id: chatId,
      session_context: null,
      db: db as any,
    });

    expect(result.match_confidence).toBe('no_match');
    expect(result.matched_property).toBeNull();
    expect(result.matched_reservation_id).toBeNull();
    expect(result.clarification_required).toBe(true);
    expect(result.suggested_clarification_question).toMatch(/which property/i);
    expect(result.candidate_reservations.length).toBe(0);
  });

  // E. Explicit address in the message overrides session context.
  it('E. explicit address wins over cached session property', async () => {
    const chatId = 99005;
    const db = makeDb([
      // The NEW hint "Литейный 12" should resolve via property knowledge.
      {
        when: q => q._table === 'tg_property_knowledge' && q._filters.some((f: any) => f.op === 'ilike' && f.col === 'location'),
        respond: { data: [{ property_id: 'prop_liteyny_12', location: 'Литейный 12' }], error: null },
      },
      { when: q => q._table === 'tg_guest_reservations', respond: { data: [], error: null } },
      { when: q => q._table === 'tg_guest_identities', respond: { data: [], error: null } },
    ]);

    const result = await matchTelegramOperationalEntitiesV1({
      surfaceLang: 'ru',
      update_id: 5000,
      scenario: 'wifi_issue',
      extracted_facts: { issue_type: 'wifi_issue', property_hint: 'Литейный 12', guest_name: null } as any,
      chat_id: chatId,
      // Session had a DIFFERENT property from a prior turn — it must NOT win.
      session_context: {
        matched_property_id: 'prop_nevsky_24',
        matched_property_label: 'Невский 24',
        matched_reservation_id: null,
      },
      db: db as any,
    });

    expect(result.matched_property?.property_id).toBe('prop_liteyny_12');
    expect(result.explicit_property_hint).toBe('Литейный 12');
    // The session match should be recorded as diagnostics but NOT win:
    expect(result.session_property_match).toBeNull();
    expect(result.candidate_matches.some(c => c.property_id === 'prop_liteyny_12')).toBe(true);
    expect(result.clarification_required).toBe(false);
  });
});
