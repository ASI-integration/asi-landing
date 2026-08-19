import { describe, expect, it } from 'vitest';

import { classifyGuestCommunicationIntent } from '../guest-intent-router';
import { getConfiguredLlmSafeDomainProvider } from '../llm-safe-domain-layer';
import {
  containsCopyableGuestData,
  evaluateVoiceResponsePolicy,
  splitCopyableGuestData,
} from '../voice-response-policy';
import { DEFAULT_PROPERTY_VOICE_POLICY } from '../voice-response-settings';
import { resolvePropertyTimezone } from '../property-timezone';

const budget = {
  dailyReplyCount: 0,
  dailyEstimatedSeconds: 0,
  monthlyEstimatedSeconds: 0,
  dailyCapReached: false,
  monthlyCapReached: false,
};

describe('Semantic Concierge v2', () => {
  it('does not turn a casual apartment mention into a property-passport question', () => {
    const result = classifyGuestCommunicationIntent({
      messageText: 'Здравствуйте. Я только что прилетел в Петербург. Очень устал с дороги, хочу отдохнуть в вашей квартире.',
      currentIdentity: 'test_guest',
    });
    expect(result.detectedIntent).toBe('unclear_role');
    expect(result.shouldEscalate).toBe(false);
  });

  it('keeps explicit property questions deterministic', () => {
    expect(
      classifyGuestCommunicationIntent({
        messageText: 'Расскажите, пожалуйста, что есть в квартире?',
        currentIdentity: 'test_guest',
      }).detectedIntent,
    ).toBe('guest_property_question');
    expect(
      classifyGuestCommunicationIntent({
        messageText: 'Какой адрес квартиры?',
        currentIdentity: 'test_guest',
      }).detectedIntent,
    ).toBe('guest_property_question');
  });

  it('keeps local recommendations ahead of generic property wording', () => {
    expect(
      classifyGuestCommunicationIntent({
        messageText: 'Посоветуйте хороший ресторан недалеко от объекта.',
        currentIdentity: 'test_guest',
      }).detectedIntent,
    ).toBe('guest_local_recommendation');
  });

  it('keeps sensitive rails deterministic', () => {
    const result = classifyGuestCommunicationIntent({
      messageText: 'Замок сломан, я не могу попасть внутрь.',
      currentIdentity: 'test_guest',
    });
    expect(result.detectedIntent).toBe('emergency_or_damage');
    expect(result.shouldEscalate).toBe(true);
  });

  it('uses an available OpenAI-compatible key when the separate LLM router is disabled', () => {
    const names = [
      'LLM_SAFE_DOMAIN_ENABLED',
      'GUEST_CONCIERGE_LLM_ENABLED',
      'LLM_SAFE_DOMAIN_PROVIDER',
      'LLM_ROUTER_PROVIDER',
      'OPENAI_API_KEY',
      'LLM_API_KEY',
      'DEEPSEEK_API_KEY',
      'LLM_BASE_URL',
      'LLM_MODEL',
    ] as const;
    const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    try {
      process.env.LLM_SAFE_DOMAIN_ENABLED = '1';
      delete process.env.GUEST_CONCIERGE_LLM_ENABLED;
      delete process.env.LLM_SAFE_DOMAIN_PROVIDER;
      process.env.LLM_ROUTER_PROVIDER = 'disabled';
      delete process.env.OPENAI_API_KEY;
      process.env.LLM_API_KEY = 'test-openai-compatible-key';
      delete process.env.DEEPSEEK_API_KEY;
      process.env.LLM_BASE_URL = 'https://example.invalid/v1';
      process.env.LLM_MODEL = 'test-mini-model';

      const provider = getConfiguredLlmSafeDomainProvider();
      expect(provider?.name).toBe('openai');
      expect(provider?.modelName).toBe('test-mini-model');
    } finally {
      for (const name of names) {
        const value = saved[name];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it('mirrors a safe adjacent voice turn as voice by default', () => {
    const decision = evaluateVoiceResponsePolicy({
      inboundTransport: 'telegram_voice',
      userVoiceSettings: {
        voiceRepliesEnabled: true,
        voiceNoticeSent: false,
        preferredResponseModality: null,
      },
      propertyVoiceSettings: { ...DEFAULT_PROPERTY_VOICE_POLICY },
      budget,
      replyText: 'Конечно. Скажите, вам хочется грузинскую кухню или просто хороший недорогой ужин?',
      ttsConfigured: true,
      propertyTimezone: resolvePropertyTimezone('Europe/Moscow'),
      role: 'guest',
      detectedIntent: 'guest_local_recommendation',
      domainZone: 'adjacent',
      responseMode: 'answer_from_concierge',
    });
    expect(DEFAULT_PROPERTY_VOICE_POLICY.voiceForAllInboundVoice).toBe(true);
    expect(decision.shouldSendVoice).toBe(true);
    expect(decision.reason).toBe('inbound_voice_allowed');
  });

  it('splits exact copyable data into compact companion text instead of duplicating the whole reply', () => {
    const reply = 'Да, конечно. Адрес: Санкт-Петербург, Лиговский проспект, 108. Заезд после 14:00.';
    expect(containsCopyableGuestData(reply)).toBe(true);
    const split = splitCopyableGuestData(reply);
    expect(split.voiceText).toContain('Да, конечно');
    expect(split.voiceText).toContain('Заезд после 14:00');
    expect(split.voiceText).not.toContain('Лиговский');
    expect(split.companionText).toContain('Адрес: Санкт-Петербург, Лиговский проспект, 108');

    const decision = evaluateVoiceResponsePolicy({
      inboundTransport: 'telegram_voice',
      userVoiceSettings: {
        voiceRepliesEnabled: true,
        voiceNoticeSent: false,
        preferredResponseModality: null,
      },
      propertyVoiceSettings: { ...DEFAULT_PROPERTY_VOICE_POLICY },
      budget,
      replyText: reply,
      ttsConfigured: true,
      propertyTimezone: resolvePropertyTimezone('Europe/Moscow'),
      role: 'guest',
      detectedIntent: 'guest_property_question',
      domainZone: 'core',
      responseMode: 'answer_from_property',
    });
    expect(decision.shouldSendVoice).toBe(true);
    expect(decision.reason).toBe('inbound_voice_with_companion_text');
    expect(decision.companionText).toContain('Лиговский');
    expect(decision.voiceText).not.toContain('Лиговский');
  });
});
