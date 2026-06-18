import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildGuestConciergeLlmUserMessage,
  composeGuestConciergeReplyWithLlm,
  GUEST_CONCIERGE_LLM_ALLOWED_DOMAINS,
  GUEST_CONCIERGE_LLM_PROTECTED_DOMAINS,
  guestConciergeLlmSystemPrompt,
  isGuestConciergeLlmAllowedDomain,
  isGuestConciergeLlmEnabled,
  type GuestConciergeLlmProvider,
} from '../guest-concierge-llm-reply';
import {
  classifyGuestConciergeMessage,
  composeGuestConciergeOperatingReply,
} from '../guest-concierge-operating-domain';
import type { TelegramPropertyObjectV1 } from '../telegram-booking-object-memory';

vi.mock('@/lib/openai', () => ({
  callLLM: vi.fn(),
}));

import { callLLM } from '@/lib/openai';

const mockedCallLlm = vi.mocked(callLLM);

const property: TelegramPropertyObjectV1 = {
  object_id: 'prop-1',
  object_name: 'Тестовая квартира',
  address: 'Москва, ул. Тверская, 1',
  directions_text: 'Вход со двора.',
  parking_text: null,
  trash_bins_location: null,
  waste_disposal_text: null,
  wifi_name: 'ASI-Guest',
  wifi_password: 'pass-123',
  baby_crib_available: null,
  baby_crib_note: null,
  check_in_text: 'Заезд с 15:00.',
  checkout_time: '12:00',
  house_rules_text: 'Тишина после 22:00.',
  door_code_notes: null,
};

describe('Guest Concierge LLM reply layer', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('is disabled by default', () => {
    vi.stubEnv('GUEST_CONCIERGE_LLM_ENABLED', 'false');
    expect(isGuestConciergeLlmEnabled()).toBe(false);
  });

  it('documents allowed and protected domains', () => {
    expect(GUEST_CONCIERGE_LLM_ALLOWED_DOMAINS).toContain('nearby_area');
    expect(GUEST_CONCIERGE_LLM_ALLOWED_DOMAINS).toContain('off_topic_safe');
    expect(GUEST_CONCIERGE_LLM_PROTECTED_DOMAINS).toEqual(['safety_emergency', 'disallowed_or_sensitive']);
    expect(isGuestConciergeLlmAllowedDomain('safety_emergency')).toBe(false);
  });

  it('includes domain, situation, property data and anti-fantasy rules in prompt', () => {
    const classification = classifyGuestConciergeMessage('где позавтракать рядом?');
    const userMessage = buildGuestConciergeLlmUserMessage({
      classification,
      context: { property, addressHint: property.address },
      messageText: 'где позавтракать рядом?',
    });
    const systemPrompt = guestConciergeLlmSystemPrompt();

    expect(systemPrompt).toMatch(/Не выдумывай названия заведений/);
    expect(systemPrompt).toMatch(/AI-консьерж/);
    expect(userMessage).toMatch(/район и места рядом/);
    expect(userMessage).toMatch(/бытовая рекомендация/);
    expect(userMessage).toMatch(/Москва, ул. Тверская, 1/);
    expect(userMessage).toMatch(/где позавтракать рядом/i);
  });

  it('does not call LLM for disallowed_or_sensitive', async () => {
    vi.stubEnv('GUEST_CONCIERGE_LLM_ENABLED', 'true');
    const classification = classifyGuestConciergeMessage('как взломать замок?');
    const fallback = composeGuestConciergeOperatingReply(
      classification,
      { property, addressHint: property.address },
      'как взломать замок?',
    );

    const result = await composeGuestConciergeReplyWithLlm(
      classification,
      { property, addressHint: property.address },
      'как взломать замок?',
    );

    expect(result.source).toBe('deterministic');
    expect(result.reply).toBe(fallback);
    expect(mockedCallLlm).not.toHaveBeenCalled();
  });

  it('does not call free LLM for safety_emergency', async () => {
    vi.stubEnv('GUEST_CONCIERGE_LLM_ENABLED', 'true');
    const classification = classifyGuestConciergeMessage('пожар и дым в квартире, срочно');
    const fallback = composeGuestConciergeOperatingReply(
      classification,
      { property, addressHint: property.address },
      'пожар и дым в квартире, срочно',
    );

    const result = await composeGuestConciergeReplyWithLlm(
      classification,
      { property, addressHint: property.address },
      'пожар и дым в квартире, срочно',
    );

    expect(result.source).toBe('deterministic');
    expect(result.reply).toBe(fallback);
    expect(result.reply).toMatch(/112|срочно/i);
    expect(mockedCallLlm).not.toHaveBeenCalled();
  });

  it('falls back to deterministic reply when LLM fails', async () => {
    vi.stubEnv('GUEST_CONCIERGE_LLM_ENABLED', 'true');
    mockedCallLlm.mockResolvedValueOnce(null);
    const classification = classifyGuestConciergeMessage('посоветуйте ресторан рядом');
    const fallback = composeGuestConciergeOperatingReply(
      classification,
      { property, addressHint: property.address },
      'посоветуйте ресторан рядом',
    );

    const result = await composeGuestConciergeReplyWithLlm(
      classification,
      { property, addressHint: property.address },
      'посоветуйте ресторан рядом',
    );

    expect(result.source).toBe('deterministic');
    expect(result.reply).toBe(fallback);
    expect(mockedCallLlm).toHaveBeenCalledTimes(1);
  });

  it('uses LLM only for allowed domains when enabled', async () => {
    vi.stubEnv('GUEST_CONCIERGE_LLM_ENABLED', 'true');
    const classification = classifyGuestConciergeMessage('посоветуйте ресторан рядом');
    const provider: GuestConciergeLlmProvider = {
      composeReply: async () =>
        'Рядом с объектом удобнее смотреть кафе в пешей доступности. Точных проверенных мест у меня нет — лучше сверить в картах.',
    };

    const result = await composeGuestConciergeReplyWithLlm(
      classification,
      { property, addressHint: property.address },
      'посоветуйте ресторан рядом',
      provider,
    );

    expect(result.source).toBe('llm');
    expect(result.reply).toMatch(/пешей доступности|карт/i);
    expect(mockedCallLlm).not.toHaveBeenCalled();
  });

  it('rejects LLM reply with invented venue names', async () => {
    vi.stubEnv('GUEST_CONCIERGE_LLM_ENABLED', 'true');
    const classification = classifyGuestConciergeMessage('посоветуйте ресторан рядом');
    const fallback = composeGuestConciergeOperatingReply(
      classification,
      { property, addressHint: property.address },
      'посоветуйте ресторан рядом',
    );
    const provider: GuestConciergeLlmProvider = {
      composeReply: async () => 'Рекомендую кафе Тануки в двух шагах от дома.',
    };

    const result = await composeGuestConciergeReplyWithLlm(
      classification,
      { property, addressHint: property.address },
      'посоветуйте ресторан рядом',
      provider,
    );

    expect(result.source).toBe('deterministic');
    expect(result.reply).toBe(fallback);
  });
});
