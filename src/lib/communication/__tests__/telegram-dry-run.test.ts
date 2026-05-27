import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockProcessMessage = vi.fn();

vi.mock('../orchestrator', () => ({
  processMessage: (...args: unknown[]) => mockProcessMessage(...args),
}));

import { runTelegramDryRun } from '../telegram-dry-run';

describe('telegram dry-run', () => {
  beforeEach(() => {
    mockProcessMessage.mockReset();
    mockProcessMessage.mockResolvedValue({
      outcome: 'replied',
      reply: 'dry-run reply',
    });
  });

  it('returns multi-intent actions and detected intents', async () => {
    const out = await runTelegramDryRun({
      text: 'Можно заезд в 15:00 и ранний в 12:00, поздний выезд до 13:00 и где wifi?',
      chatId: 'test-chat',
      objectName: 'Тверской',
      bookingId: 'test-booking',
    });

    expect(out.detectedIntents.length).toBeGreaterThan(1);
    expect(out.detectedIntents).toContain('check_in_standard');
    expect(out.actions).toContain('reply');
    expect(out.replyText).toBe('dry-run reply');
    expect(out.finalReplied).toBe(true);
    expect(out.slowAckSent).toBe(false);
  });

  it('marks complaint as escalated', async () => {
    const out = await runTelegramDryRun({
      text: 'Жалоба: шум и проблема в квартире, нужен оператор',
      chatId: 'test-chat',
      objectName: 'Тверской',
      bookingId: 'test-booking',
    });

    expect(out.detectedIntents).toContain('complaints_problems');
    expect(out.actions).toContain('escalate_operator');
    expect(out.escalated).toBe(true);
  });

  it('marks urgent access as escalated', async () => {
    const out = await runTelegramDryRun({
      text: 'Срочно, не могу войти прямо сейчас, код двери не работает',
      chatId: 'test-chat',
      objectName: 'Тверской',
      bookingId: 'test-booking',
    });

    expect(out.detectedIntents).toContain('access_key_issue');
    expect(out.actions).toContain('escalate_operator');
    expect(out.escalated).toBe(true);
  });

  it('returns no operational actions for bot/meta smalltalk', async () => {
    mockProcessMessage.mockResolvedValueOnce({
      outcome: 'replied',
      reply: 'Да, я бот ASI. Помогаю быстро разобрать сообщения гостей, вопросы по заезду и проблемы с объектом.',
    });

    const out = await runTelegramDryRun({
      text: 'А ты умный бот?',
      chatId: 'test-chat',
    });

    expect(out.replyText).toMatch(/бот ASI/i);
    expect(out.detectedIntents).toEqual([]);
    expect(out.actions).toEqual([]);
    expect(out.escalated).toBe(false);
    expect(out.finalReplied).toBe(true);

    const botQuestion = await runTelegramDryRun({
      text: 'ты бот?',
      chatId: 'test-chat',
    });

    expect(botQuestion.detectedIntents).toEqual([]);
    expect(botQuestion.actions).toEqual([]);
    expect(botQuestion.escalated).toBe(false);
  });

  it('returns no operational actions for short thanks', async () => {
    mockProcessMessage.mockResolvedValueOnce({
      outcome: 'replied',
      reply: 'Пожалуйста! Если появится запрос гостя или вопрос по объекту, пришлите сюда.',
    });

    const out = await runTelegramDryRun({
      text: 'спасибо',
      chatId: 'test-chat',
    });

    expect(out.actions).toEqual([]);
    expect(out.escalated).toBe(false);
  });

  it('returns no operational actions or escalation for Telegram test probes', async () => {
    mockProcessMessage.mockResolvedValueOnce({
      outcome: 'replied',
      reply: 'Бот на связи.',
    });

    const out = await runTelegramDryRun({
      text: 'тест один ответ 1629',
      chatId: 'test-chat',
    });

    expect(out.replyText).toMatch(/бот на связи/i);
    expect(out.detectedIntents).toEqual([]);
    expect(out.actions).toEqual([]);
    expect(out.escalated).toBe(false);
    expect(out.finalReplied).toBe(true);
  });

  it('asks clarification for unknown object context', async () => {
    const out = await runTelegramDryRun({
      text: 'Где wifi и можно поздний выезд до 13:00?',
      chatId: 'test-chat',
      objectName: '',
      bookingId: '',
    });

    expect(out.actions).toContain('clarify');
    expect(out.escalated).toBe(false);
  });
});
