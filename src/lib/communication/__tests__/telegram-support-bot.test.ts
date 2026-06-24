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

  it('classifies auto-support intents', () => {
    expect(classifySupportBotIntent('хочу подключить квартиру')).toBe('connect_property');
    expect(classifySupportBotIntent('подключить объект')).toBe('connect_property');
    expect(classifySupportBotIntent('как начать')).toBe('connect_property');
    expect(classifySupportBotIntent('сколько стоит')).toBe('pricing_pilot');
    expect(classifySupportBotIntent('пилот бесплатно')).toBe('pricing_pilot');
    expect(classifySupportBotIntent('что такое ASI')).toBe('about_asi');
    expect(classifySupportBotIntent('что умеет система')).toBe('about_asi');
    expect(classifySupportBotIntent('не работает, нужен оператор')).toBe('needs_human');
    expect(classifySupportBotIntent('помогите')).toBe('needs_human');
    expect(classifySupportBotIntent('случайный набор слов xyz')).toBe('unknown');
  });

  it('returns Russian auto-replies without OPS escalation for FAQ intents', () => {
    const connectReply = buildSupportBotReply('connect_property');
    expect(connectReply).toMatch(/Поняла/);
    expect(connectReply).toContain(`@${TELEGRAM_CORE_BOT_HANDLE}`);

    const pricingReply = buildSupportBotReply('pricing_pilot');
    expect(pricingReply).toMatch(/пилот/i);

    const aboutReply = buildSupportBotReply('about_asi');
    expect(aboutReply).toMatch(/автопилот/i);
  });

  it('creates OPS only for needs_human and unknown intents', () => {
    expect(shouldCreateSupportOpsTask('connect_property')).toBe(false);
    expect(shouldCreateSupportOpsTask('pricing_pilot')).toBe(false);
    expect(shouldCreateSupportOpsTask('about_asi')).toBe(false);
    expect(shouldCreateSupportOpsTask('needs_human')).toBe(true);
    expect(shouldCreateSupportOpsTask('unknown')).toBe(true);
  });

  it('builds dedup keys for support_review tasks', () => {
    const key = buildSupportOpsDedupKey(12345, 'хочу подключить квартиру', 1_800_000);
    expect(key).toContain('auto:telegram_support:');
    expect(key).toContain(':support_review');
  });
});
