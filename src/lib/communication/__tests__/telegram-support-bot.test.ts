import { describe, expect, it } from 'vitest';

import {
  buildSupportBotReply,
  buildSupportOpsDedupKey,
  classifySupportBotIntent,
  shouldCreateSupportOpsTask,
} from '@/lib/communication/telegram-support-bot';
import { TELEGRAM_CORE_BOT_HANDLE, TELEGRAM_SUPPORT_BOT_HANDLE } from '@/config/telegramBots';

describe('telegram support bot', () => {
  it('keeps public bot handles stable', () => {
    expect(TELEGRAM_SUPPORT_BOT_HANDLE).toBe('ASI_Support_Bot');
    expect(TELEGRAM_CORE_BOT_HANDLE).toBe('ASI_core_bot');
  });

  it('classifies MVP support intents', () => {
    expect(classifySupportBotIntent('хочу подключить квартиру')).toBe('connect_property');
    expect(classifySupportBotIntent('интересует пилот')).toBe('pilot_interest');
    expect(classifySupportBotIntent('нужна помощь')).toBe('question');
    expect(classifySupportBotIntent('что умеет ASI')).toBe('question');
    expect(classifySupportBotIntent('случайный набор слов xyz')).toBe('unknown');
  });

  it('returns short Russian replies', () => {
    const reply = buildSupportBotReply('connect_property');
    expect(reply).toMatch(/Поняла/);
    expect(reply).toMatch(/город/);
  });

  it('creates OPS only for unknown intents', () => {
    expect(shouldCreateSupportOpsTask('connect_property')).toBe(false);
    expect(shouldCreateSupportOpsTask('unknown')).toBe(true);
  });

  it('builds dedup keys for support_review tasks', () => {
    const key = buildSupportOpsDedupKey(12345, 'хочу подключить квартиру', 1_800_000);
    expect(key).toContain('auto:telegram_support:');
    expect(key).toContain(':support_review');
  });
});
