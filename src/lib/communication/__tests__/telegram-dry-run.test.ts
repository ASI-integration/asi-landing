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
