import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processTelegramOperationalIntakeWithSessionMemory } from '../telegram-session-memory';
import { __resetAutonomousSessionStoreForTests, getAutonomousSessionOperationalCaseV1 } from '../conversation-session-store';

describe('telegram session memory v1 (operational cases)', () => {
  beforeEach(() => {
    __resetAutonomousSessionStoreForTests();
  });

  afterEach(() => {
    __resetAutonomousSessionStoreForTests();
  });

  it('2-message completion (EN): clarify(property) then property fragment resolves same case', () => {
    const chatId = 1001;
    const r1 = processTelegramOperationalIntakeWithSessionMemory({
      chatId,
      channel: 'telegram',
      update_id: 1,
      surfaceLang: 'en',
      text: "Guest John Smith can't enter, door code does not work. Today at 18:00.",
    });
    expect(r1.handled).toBe(true);
    if (!r1.handled) throw new Error('expected handled');
    expect(r1.hit.category).toBe('access_issue');
    expect(r1.hit.finalAction).toBe('clarify');
    expect(r1.hit.missingFacts).toContain('property');

    const r2 = processTelegramOperationalIntakeWithSessionMemory({
      chatId,
      channel: 'telegram',
      update_id: 2,
      surfaceLang: 'en',
      text: 'Nevsky 24',
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

  it('3-message completion (RU): clarify(property) then clarify(details) then resolve', () => {
    const chatId = 2002;
    const r1 = processTelegramOperationalIntakeWithSessionMemory({
      chatId,
      channel: 'telegram',
      update_id: 10,
      surfaceLang: 'ru',
      text: 'WiFi',
    });
    expect(r1.handled).toBe(true);
    if (!r1.handled) throw new Error('expected handled');
    expect(r1.hit.category).toBe('wifi_issue');
    expect(r1.hit.finalAction).toBe('clarify');
    expect(r1.hit.missingFacts).toContain('property');

    const r2 = processTelegramOperationalIntakeWithSessionMemory({
      chatId,
      channel: 'telegram',
      update_id: 11,
      surfaceLang: 'ru',
      text: 'Невский 24',
    });
    expect(r2.handled).toBe(true);
    if (!r2.handled) throw new Error('expected handled');
    expect(r2.hit.category).toBe('wifi_issue');
    expect(r2.hit.finalAction).toBe('clarify');
    expect(r2.hit.missingFacts).toContain('wifi_details');
    expect(r2.hit.reply).toMatch(/не работает|пароль|сеть/i);

    const r3 = processTelegramOperationalIntakeWithSessionMemory({
      chatId,
      channel: 'telegram',
      update_id: 12,
      surfaceLang: 'ru',
      text: 'Пароль не подходит, не подключается.',
    });
    expect(r3.handled).toBe(true);
    if (!r3.handled) throw new Error('expected handled');
    expect(r3.hit.category).toBe('wifi_issue');
    expect(r3.hit.finalAction).toBe('reply');

    const mem = getAutonomousSessionOperationalCaseV1(chatId);
    expect(mem?.status).toBe('resolved');
    expect(mem?.missing_facts).toEqual([]);
  });

  it('unrelated message starts a new case (EN)', () => {
    const chatId = 3003;
    const r1 = processTelegramOperationalIntakeWithSessionMemory({
      chatId,
      channel: 'telegram',
      update_id: 1,
      surfaceLang: 'en',
      text: "Guest can't enter, door code does not work.",
    });
    expect(r1.handled).toBe(true);
    if (!r1.handled) throw new Error('expected handled');
    expect(r1.hit.category).toBe('access_issue');
    expect(r1.hit.finalAction).toBe('clarify');

    const r2 = processTelegramOperationalIntakeWithSessionMemory({
      chatId,
      channel: 'telegram',
      update_id: 2,
      surfaceLang: 'en',
      text: 'Late checkout tomorrow until 13:00 @ Nevsky 24.',
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

  it('emits deterministic session_memory_update logs with required keys', () => {
    const chatId = 4004;
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    processTelegramOperationalIntakeWithSessionMemory({
      chatId,
      channel: 'telegram',
      update_id: 55,
      surfaceLang: 'en',
      text: 'Wi-Fi is not working.',
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

