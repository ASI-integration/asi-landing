import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processTelegramOperationalIntakeWithSessionMemory } from '../telegram-session-memory';
import { __resetAutonomousSessionStoreForTests, getAutonomousSessionOperationalCaseV1 } from '../conversation-session-store';

describe('telegram session memory v1 (operational cases)', () => {
  function makeEmptyDb() {
    return {
      from: () => {
        const q: any = {
          select: () => q,
          ilike: () => q,
          eq: () => q,
          in: () => q,
          gte: () => q,
          lte: () => q,
          order: () => q,
          limit: () => q,
          maybeSingle: async () => ({ data: null, error: { message: 'not used' } }),
          then: (resolve: any, reject: any) => Promise.resolve({ data: [], error: null }).then(resolve, reject),
        };
        return q;
      },
    };
  }

  function makeDurableContextDb() {
    const rows = new Map<number, { conversation_context_v1: any }>();
    return {
      db: {
        from: (table: string) => {
          const q: any = {
            _chatId: null as number | null,
            select: () => q,
            ilike: () => q,
            eq: (_col: string, val: any) => {
              q._chatId = Number(val);
              return q;
            },
            in: () => q,
            gte: () => q,
            lte: () => q,
            order: () => q,
            limit: () => q,
            upsert: async (payload: any) => {
              if (table === 'tg_conversation_sessions' && Number.isFinite(Number(payload?.chat_id))) {
                rows.set(Number(payload.chat_id), {
                  conversation_context_v1: payload?.conversation_context_v1 ?? {},
                });
              }
              return { data: null, error: null };
            },
            maybeSingle: async () => {
              if (table !== 'tg_conversation_sessions' || !Number.isFinite(q._chatId)) {
                return { data: null, error: null };
              }
              const row = rows.get(q._chatId as number);
              return { data: row ? { conversation_context_v1: row.conversation_context_v1 } : null, error: null };
            },
            then: (resolve: any, reject: any) => {
              if (table === 'tg_conversation_sessions' && Number.isFinite(q._chatId)) {
                const row = rows.get(q._chatId as number);
                return Promise.resolve({ data: row ? [{ conversation_context_v1: row.conversation_context_v1 }] : [], error: null }).then(resolve, reject);
              }
              return Promise.resolve({ data: [], error: null }).then(resolve, reject);
            },
          };
          return q;
        },
      },
      getRow: (chatId: number) => rows.get(chatId),
    };
  }

  beforeEach(() => {
    __resetAutonomousSessionStoreForTests();
  });

  afterEach(() => {
    __resetAutonomousSessionStoreForTests();
  });

  it('2-message completion (EN): escalate_urgent then property fragment resolves same case', async () => {
    const chatId = 1001;
    const r1 = await processTelegramOperationalIntakeWithSessionMemory({
      chatId,
      channel: 'telegram',
      update_id: 1,
      surfaceLang: 'en',
      text: "Guest John Smith can't enter, door code does not work. Today at 18:00.",
      db: makeEmptyDb(),
    });
    expect(r1.handled).toBe(true);
    if (!r1.handled) throw new Error('expected handled');
    expect(r1.hit.category).toBe('access_issue');
    expect(r1.hit.finalAction).toBe('escalate_urgent');
    expect(r1.hit.missingFacts).toContain('property');

    const r2 = await processTelegramOperationalIntakeWithSessionMemory({
      chatId,
      channel: 'telegram',
      update_id: 2,
      surfaceLang: 'en',
      text: 'Nevsky 24',
      db: makeEmptyDb(),
    });
    expect(r2.handled).toBe(true);
    if (!r2.handled) throw new Error('expected handled');
    expect(r2.hit.category).toBe('access_issue');
    expect(r2.hit.finalAction).toBe('reply');
    expect(r2.hit.reply).toMatch(/access issue logged|Understood/i);

    const mem = getAutonomousSessionOperationalCaseV1(chatId);
    expect(mem?.status).toBe('resolved');
    expect(mem?.property).toMatch(/Nevsky|Невск/i);
  });

  it('3-message completion (RU): one clarification max, then escalate, then resolve on fragment', async () => {
    const chatId = 2002;
    const r1 = await processTelegramOperationalIntakeWithSessionMemory({
      chatId,
      channel: 'telegram',
      update_id: 10,
      surfaceLang: 'ru',
      text: 'WiFi',
      db: makeEmptyDb(),
    });
    expect(r1.handled).toBe(true);
    if (!r1.handled) throw new Error('expected handled');
    expect(r1.hit.category).toBe('wifi_issue');
    expect(r1.hit.finalAction).toBe('clarify');
    expect(r1.hit.missingFacts).toContain('property');

    const r2 = await processTelegramOperationalIntakeWithSessionMemory({
      chatId,
      channel: 'telegram',
      update_id: 11,
      surfaceLang: 'ru',
      text: 'Невский 24',
      db: makeEmptyDb(),
    });
    expect(r2.handled).toBe(true);
    if (!r2.handled) throw new Error('expected handled');
    expect(r2.hit.category).toBe('wifi_issue');
    expect(r2.hit.finalAction).toBe('escalate_operator');
    expect(r2.hit.missingFacts).toContain('wifi_details');
    expect(r2.hit.reply).toMatch(/передаю|оператор/i);

    const r3 = await processTelegramOperationalIntakeWithSessionMemory({
      chatId,
      channel: 'telegram',
      update_id: 12,
      surfaceLang: 'ru',
      text: 'Пароль не подходит, не подключается.',
      db: makeEmptyDb(),
    });
    expect(r3.handled).toBe(true);
    if (!r3.handled) throw new Error('expected handled');
    expect(r3.hit.category).toBe('wifi_issue');
    expect(r3.hit.finalAction).toBe('reply');

    const mem = getAutonomousSessionOperationalCaseV1(chatId);
    expect(mem?.status).toBe('resolved');
    expect(mem?.missing_facts).toEqual([]);
  });

  it('unrelated message starts a new case (EN)', async () => {
    const chatId = 3003;
    const r1 = await processTelegramOperationalIntakeWithSessionMemory({
      chatId,
      channel: 'telegram',
      update_id: 1,
      surfaceLang: 'en',
      text: "Guest can't enter, door code does not work.",
      db: makeEmptyDb(),
    });
    expect(r1.handled).toBe(true);
    if (!r1.handled) throw new Error('expected handled');
    expect(r1.hit.category).toBe('access_issue');
    expect(r1.hit.finalAction).toBe('escalate_urgent');

    const r2 = await processTelegramOperationalIntakeWithSessionMemory({
      chatId,
      channel: 'telegram',
      update_id: 2,
      surfaceLang: 'en',
      text: 'Late checkout tomorrow until 13:00 @ Nevsky 24.',
      db: makeEmptyDb(),
    });
    expect(r2.handled).toBe(true);
    if (!r2.handled) throw new Error('expected handled');
    expect(r2.hit.category).toBe('late_checkout');
    // should be able to resolve immediately due to @ property
    expect(r2.hit.finalAction).toBe('reply');

    const mem = getAutonomousSessionOperationalCaseV1(chatId);
    expect(mem?.category).toBe('late_checkout');
    expect(mem?.status).toBe('resolved');
  });

  it('distinguishes RU 15:00, 12:00, and 07:00 check-in timing policy', async () => {
    const r15 = await processTelegramOperationalIntakeWithSessionMemory({
      chatId: 5101,
      channel: 'telegram',
      update_id: 31,
      surfaceLang: 'ru',
      text: 'Хочу заехать завтра в 15:00, можно ранний заезд?',
      db: makeEmptyDb(),
    });
    expect(r15.handled).toBe(true);
    if (!r15.handled) throw new Error('expected handled');
    expect(r15.hit.category).toBe('checkin_time_question');
    expect(r15.hit.reply).toMatch(/15:00 обычно считается стандартным временем заезда, не ранним/i);

    const r12 = await processTelegramOperationalIntakeWithSessionMemory({
      chatId: 5102,
      channel: 'telegram',
      update_id: 32,
      surfaceLang: 'ru',
      text: 'Можно заехать в 12:00?',
      db: makeEmptyDb(),
    });
    expect(r12.handled).toBe(true);
    if (!r12.handled) throw new Error('expected handled');
    expect(r12.hit.category).toBe('early_checkin');
    expect(r12.hit.reply).toMatch(/раньше стандартного времени заезда/i);
    expect(r12.hit.reply).toMatch(/уборк/i);
    expect(r12.hit.reply).toMatch(/предыдущего выезда/i);

    const r07 = await processTelegramOperationalIntakeWithSessionMemory({
      chatId: 5103,
      channel: 'telegram',
      update_id: 33,
      surfaceLang: 'ru',
      text: 'Можно заехать в 7 утра?',
      db: makeEmptyDb(),
    });
    expect(r07.handled).toBe(true);
    if (!r07.handled) throw new Error('expected handled');
    expect(r07.hit.category).toBe('early_checkin');
    expect(r07.hit.reply).toMatch(/07:00 — это очень ранний заезд/i);
    expect(r07.hit.reply).toMatch(/свободен с предыдущей ночи|нет гостя накануне/i);
    expect(r07.hit.reply).not.toMatch(/после уборки/i);
    expect(r07.hit.reply).not.toContain('(а)');
  });

  it('restores operational object/booking context from durable tg_conversation_sessions after restart', async () => {
    const chatId = 6101;
    const durable = makeDurableContextDb();

    const r1 = await processTelegramOperationalIntakeWithSessionMemory({
      chatId,
      channel: 'telegram',
      update_id: 41,
      surfaceLang: 'ru',
      text: 'Можно заехать в 7 утра?',
      db: durable.db as any,
    });
    expect(r1.handled).toBe(true);
    if (!r1.handled) throw new Error('expected handled');
    expect(r1.hit.finalAction).toBe('clarify');
    expect(r1.hit.reply).toMatch(/для какого это объекта или брони/i);
    expect(durable.getRow(chatId)?.conversation_context_v1?.operational_case).toBeTruthy();

    // Simulate process restart: clear file/in-memory session store only.
    __resetAutonomousSessionStoreForTests();

    const r2 = await processTelegramOperationalIntakeWithSessionMemory({
      chatId,
      channel: 'telegram',
      update_id: 42,
      surfaceLang: 'ru',
      text: 'Это та же бронь, объект на Тверской.',
      db: durable.db as any,
    });
    expect(r2.handled).toBe(true);
    if (!r2.handled) throw new Error('expected handled');
    expect(r2.mode).toBe('followup_fragment');
    expect(r2.hit.finalAction).toBe('reply');
    expect(r2.hit.reply).toMatch(/07:00 — это очень ранний заезд/i);
    expect(r2.hit.reply).not.toMatch(/для какого это объекта или брони/i);
    expect((r2.hit.extractedFacts as any).property).toMatch(/Тверск/i);
    expect(durable.getRow(chatId)?.conversation_context_v1?.current_object?.property_label).toMatch(/Тверск/i);
  });

  it('continues RU check-in flow after time and object follow-ups without operator fallback', async () => {
    const chatId = 5005;
    const r1 = await processTelegramOperationalIntakeWithSessionMemory({
      chatId,
      channel: 'telegram',
      update_id: 21,
      surfaceLang: 'ru',
      text: 'Здравствуйте, я гость. Хочу заехать завтра в 15:00, можно?',
      db: makeEmptyDb(),
    });
    expect(r1.handled).toBe(true);
    if (!r1.handled) throw new Error('expected handled');
    expect(r1.hit.category).toBe('checkin_time_question');
    expect(r1.hit.finalAction).toBe('clarify');
    expect(r1.hit.reply).toMatch(/15:00 обычно считается стандартным временем заезда, не ранним/i);
    expect(r1.hit.reply).toMatch(/для какого это объекта или брони/i);

    const r2 = await processTelegramOperationalIntakeWithSessionMemory({
      chatId,
      channel: 'telegram',
      update_id: 22,
      surfaceLang: 'ru',
      text: 'А если в 7 утра?',
      db: makeEmptyDb(),
    });
    expect(r2.handled).toBe(true);
    if (!r2.handled) throw new Error('expected handled');
    expect(r2.mode).toBe('followup_fragment');
    expect(r2.hit.category).toBe('early_checkin');
    expect(r2.hit.finalAction).toBe('clarify');
    expect(r2.hit.reply).toMatch(/07:00 — это очень ранний заезд/i);
    expect(r2.hit.reply).toMatch(/свободен с предыдущей ночи|нет гостя накануне/i);
    expect(r2.hit.reply).not.toMatch(/после уборки/i);
    expect(r2.hit.reply).toMatch(/для какого это объекта или брони/i);
    expect(r2.hit.reply).not.toMatch(/переда[юн].*оператор|Запрос уже передан/i);
    expect(r2.hit.reply).not.toContain('(а)');

    const r3 = await processTelegramOperationalIntakeWithSessionMemory({
      chatId,
      channel: 'telegram',
      update_id: 23,
      surfaceLang: 'ru',
      text: 'Это та же бронь, объект на Тверской.',
      db: makeEmptyDb(),
    });
    expect(r3.handled).toBe(true);
    if (!r3.handled) throw new Error('expected handled');
    expect(r3.hit.category).toBe('early_checkin');
    expect(r3.hit.finalAction).toBe('reply');
    expect(r3.hit.reply).toMatch(/07:00 — это очень ранний заезд/i);
    expect(r3.hit.reply).toMatch(/свободен с предыдущей ночи|нет гостя накануне/i);
    expect(r3.hit.reply).not.toMatch(/после уборки/i);
    expect(r3.hit.reply).not.toMatch(/для какого это объекта или брони/i);
    expect(r3.hit.reply).not.toMatch(/переда[юн].*оператор|Запрос уже передан/i);
    expect(r3.hit.reply).not.toBe(r2.hit.reply);

    const mem = getAutonomousSessionOperationalCaseV1(chatId);
    expect(mem?.status).toBe('resolved');
    expect(mem?.property).toMatch(/Тверск/i);
    expect((mem?.extracted_facts as any)?.requestedTime).toBe('07:00');
  });

  it('emits deterministic session_memory_update logs with required keys', async () => {
    const chatId = 4004;
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await processTelegramOperationalIntakeWithSessionMemory({
      chatId,
      channel: 'telegram',
      update_id: 55,
      surfaceLang: 'en',
      text: 'Wi-Fi is not working.',
      db: makeEmptyDb(),
    });

    const calls = spy.mock.calls
      .map(args => String(args[0]))
      .filter(s => s.includes('"route":"session_memory_update"'));
    expect(calls.length).toBeGreaterThan(0);
    const payload = JSON.parse(calls[calls.length - 1] ?? '{}') as any;
    expect(payload.route).toBe('session_memory_update');
    expect(payload.session_id).toBe(chatId);
    expect(payload).toHaveProperty('previous_state');
    expect(payload).toHaveProperty('new_state');
    expect(payload).toHaveProperty('merged_facts');
    expect(payload).toHaveProperty('remaining_missing_facts');
    expect(payload.update_id).toBe(`tg:${chatId}:55`);

    spy.mockRestore();
  });
});

