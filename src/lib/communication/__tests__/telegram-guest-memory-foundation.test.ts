import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { composeTelegramOperationalReply } from '../telegram-reply-composer';
import { processTelegramOperationalIntakeWithSessionMemory } from '../telegram-session-memory';
import {
  canRevealTelegramAccessDetails,
  resolveTelegramGuestIdentityV1,
} from '../telegram-guest-memory';
import { __resetAutonomousSessionStoreForTests } from '../conversation-session-store';

function makeDb(seed?: {
  identities?: any[];
  profiles?: any[];
  reservations?: any[];
  suspicious?: any[];
}) {
  const rows: Record<string, any[]> = {
    tg_guest_identities: seed?.identities ?? [],
    tg_guest_profiles: seed?.profiles ?? [],
    tg_guest_reservations: seed?.reservations ?? [],
    tg_suspicious_users: seed?.suspicious ?? [],
    tg_conversation_sessions: [],
    tg_property_knowledge: [],
  };

  const db = {
    from: (table: string) => {
      const q: any = {
        _table: table,
        _filters: [] as Array<{ col: string; val: any }>,
        _limit: null as number | null,
        select: () => q,
        ilike: () => q,
        in: () => q,
        gte: () => q,
        lte: () => q,
        order: () => q,
        limit: (n: number) => {
          q._limit = n;
          return q;
        },
        eq: (col: string, val: any) => {
          q._filters.push({ col, val });
          return q;
        },
        upsert: async (payload: any) => {
          if (table === 'tg_conversation_sessions') {
            const idx = rows[table].findIndex((r) => Number(r.chat_id) === Number(payload.chat_id));
            if (idx >= 0) rows[table][idx] = { ...rows[table][idx], ...payload };
            else rows[table].push(payload);
          }
          return { data: null, error: null };
        },
        maybeSingle: async () => {
          const data = materialize(q);
          return { data: data[0] ?? null, error: null };
        },
        then: (resolve: any, reject: any) => Promise.resolve({ data: materialize(q), error: null }).then(resolve, reject),
      };
      return q;
    },
    __rows: rows,
  };

  return db;

  function materialize(q: any): any[] {
    let data = [...(rows[q._table] ?? [])];
    for (const filter of q._filters) {
      data = data.filter((row) => String(row[filter.col] ?? '') === String(filter.val));
    }
    if (typeof q._limit === 'number') data = data.slice(0, q._limit);
    return data;
  }
}

const seededDb = () =>
  makeDb({
    identities: [
      {
        guest_id: 'guest-returning-1',
        telegram_chat_id: 910001,
        first_name: 'Анна',
        last_name: 'Иванова',
        phone: '79990000001',
        stays_count: 3,
      },
    ],
    profiles: [
      {
        guest_id: 'guest-returning-1',
        display_name: 'Анна Иванова',
        phone: '79990000001',
        stays_count: 3,
      },
    ],
    reservations: [
      {
        id: 'RES-1',
        booking_id: 'BK-ASI-001',
        property_id: 'prop-1',
        guest_id: 'guest-returning-1',
        guest_name: 'Анна Иванова',
        phone: '79990000001',
        guest_phone: '79990000001',
        chat_id: 910001,
        check_in: '2026-05-27T12:00:00.000Z',
        check_out: '2026-05-30T12:00:00.000Z',
      },
    ],
    suspicious: [{ telegram_chat_id: 919001, reason: 'wrong booking attempts' }],
  });

describe('telegram guest memory foundation', () => {
  beforeEach(() => {
    __resetAutonomousSessionStoreForTests();
  });

  afterEach(() => {
    __resetAutonomousSessionStoreForTests();
  });

  it('recognizes a returning Telegram guest with reservation context', async () => {
    const identity = await resolveTelegramGuestIdentityV1({
      telegram_chat_id: 910001,
      text: 'Код двери не работает',
      db: seededDb(),
    });

    expect(identity.status).toBe('verified');
    expect(identity.guest_id).toBe('guest-returning-1');
    expect(identity.current_reservation?.reservation_id).toBe('RES-1');
    expect(canRevealTelegramAccessDetails(identity)).toBe(true);
  });

  it('requires verification for a new guest before access details', async () => {
    const identity = await resolveTelegramGuestIdentityV1({
      telegram_chat_id: 100500,
      text: 'Здравствуйте, нужна инструкция по заселению',
      db: seededDb(),
    });

    expect(identity.status).toBe('unknown');
    expect(canRevealTelegramAccessDetails(identity)).toBe(false);
  });

  it('does not allow access details when booking phone is wrong', async () => {
    const identity = await resolveTelegramGuestIdentityV1({
      telegram_chat_id: 100501,
      text: 'Бронь BK-ASI-001, телефон +7 999 000 09 99. Код двери не работает.',
      db: seededDb(),
    });

    expect(identity.status).toBe('unverified');
    expect(identity.current_reservation?.reservation_id).toBe('RES-1');
    expect(canRevealTelegramAccessDetails(identity)).toBe(false);
  });

  it('does not repeat greeting inside the same active Telegram session', () => {
    const first = composeTelegramOperationalReply({
      update_id: 1,
      category: 'wifi_issue',
      action: 'clarify',
      lang: 'ru',
      text: 'не работает Wi-Fi',
      extractedFacts: {},
      missingFacts: ['property'],
      urgency: 'normal',
      sessionMemory: null,
      shouldGreet: true,
    });
    const second = composeTelegramOperationalReply({
      update_id: 2,
      category: 'wifi_issue',
      action: 'clarify',
      lang: 'ru',
      text: 'не работает Wi-Fi',
      extractedFacts: {},
      missingFacts: ['property'],
      urgency: 'normal',
      sessionMemory: null,
      shouldGreet: false,
    });

    expect(first.text).toMatch(/^Здравствуйте!/);
    expect(second.text).not.toMatch(/^Здравствуйте!/);
  });

  it('escalates urgent access issues politely and blocks door code before verification', async () => {
    const db = seededDb();
    const result = await processTelegramOperationalIntakeWithSessionMemory({
      chatId: 100502,
      channel: 'telegram',
      update_id: 77,
      surfaceLang: 'ru',
      text: 'Я у двери, код не работает',
      db,
    });

    expect(result.handled).toBe(true);
    if (!result.handled) throw new Error('expected handled');
    expect(result.hit.finalAction).toBe('escalate_urgent');
    expect(result.hit.reply).toBe('Поняла, это срочно. Уже передаю оператору по доступу. В целях безопасности код двери отправим только после проверки брони.');
    expect(result.hit.reply).not.toMatch(/mock-door-code|door-code|код:\s*\d/i);
    expect(db.__rows.tg_conversation_sessions[0].guest_history_context_v1.identity_status).toBe('unknown');
  });
});
