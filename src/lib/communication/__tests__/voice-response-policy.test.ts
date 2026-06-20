import { describe, expect, it } from 'vitest';
import { getLocalTimeParts, isWithinNightWindow, resolvePropertyTimezone } from '../property-timezone';
import { evaluateVoiceResponsePolicy, prepareVoiceTextForTts } from '../voice-response-policy';
import { DEFAULT_PROPERTY_VOICE_POLICY, VOICE_SAFE_URGENT_HANDOFF_RU } from '../voice-response-settings';

const baseInput = {
  inboundTransport: 'telegram_text' as const,
  userVoiceSettings: { voiceRepliesEnabled: true, voiceNoticeSent: false },
  propertyVoiceSettings: { ...DEFAULT_PROPERTY_VOICE_POLICY },
  budget: {
    dailyReplyCount: 0,
    dailyEstimatedSeconds: 0,
    monthlyEstimatedSeconds: 0,
    dailyCapReached: false,
    monthlyCapReached: false,
  },
  replyText: 'Здравствуйте! Wi-Fi: сеть ASI, пароль отправлен в бронировании.',
  ttsConfigured: true,
  propertyTimezone: resolvePropertyTimezone('Europe/Moscow'),
};

describe('evaluateVoiceResponsePolicy', () => {
  it('enables voice for urgent intent', () => {
    const decision = evaluateVoiceResponsePolicy({
      ...baseInput,
      detectedIntent: 'emergency_or_damage',
      domainZone: 'core',
      isUrgent: true,
    });
    expect(decision.shouldSendVoice).toBe(true);
    expect(decision.reason).toBe('urgent_intent');
    expect(decision.voiceText).toBeTruthy();
  });

  it('enables voice with safe handoff for urgent operator escalation', () => {
    const decision = evaluateVoiceResponsePolicy({
      ...baseInput,
      detectedIntent: 'emergency_or_damage',
      domainZone: 'core',
      responseMode: 'operator_escalation',
      messageRisk: 'sensitive_internal',
      isUrgent: true,
      replyText: 'Передаю оператору. reviewId=abc123 sessionId=deadbeef. Позвоните на +7999.',
    });
    expect(decision.shouldSendVoice).toBe(true);
    expect(decision.reason).toBe('urgent_intent');
    expect(decision.voiceText).toContain('срочная ситуация');
    expect(decision.voiceText).not.toMatch(/reviewid|deadbeef|7999/i);
    expect(decision.voiceText).toBe(
      prepareVoiceTextForTts(VOICE_SAFE_URGENT_HANDOFF_RU, DEFAULT_PROPERTY_VOICE_POLICY.maxVoiceTextChars),
    );
  });

  it('disables voice for non-urgent operator escalation', () => {
    const decision = evaluateVoiceResponsePolicy({
      ...baseInput,
      detectedIntent: 'general_question',
      domainZone: 'core',
      responseMode: 'operator_escalation',
      messageRisk: 'sensitive_internal',
      isUrgent: false,
    });
    expect(decision.shouldSendVoice).toBe(false);
    expect(decision.reason).toBe('sensitive_internal');
  });

  it('disables voice for daytime sensitive money text inbound', () => {
    const decision = evaluateVoiceResponsePolicy({
      ...baseInput,
      inboundTransport: 'telegram_text',
      detectedIntent: 'money_sensitive',
      messageRisk: 'sensitive_money',
      domainZone: 'core',
      now: new Date('2026-06-20T10:00:00.000Z'),
    });
    expect(decision.shouldSendVoice).toBe(false);
    expect(decision.reason).toBe('sensitive_internal');
  });

  it('enables voice for night core stay issue in property timezone', () => {
    const decision = evaluateVoiceResponsePolicy({
      ...baseInput,
      detectedIntent: 'guest_checkin',
      domainZone: 'core',
      responseMode: 'answer_from_property',
      now: new Date('2026-06-20T20:30:00.000Z'),
      propertyTimezone: resolvePropertyTimezone('Europe/Moscow'),
    });
    expect(decision.shouldSendVoice).toBe(true);
    expect(decision.reason).toBe('night_core_stay_issue');
  });

  it('disables voice for daytime adjacent restaurant question via text', () => {
    const decision = evaluateVoiceResponsePolicy({
      ...baseInput,
      detectedIntent: 'guest_local_recommendation',
      domainZone: 'adjacent',
      now: new Date('2026-06-20T10:00:00.000Z'),
    });
    expect(decision.shouldSendVoice).toBe(false);
    expect(decision.reason).toBe('not_needed');
  });

  it('allows inbound voice for core topic under cap', () => {
    const decision = evaluateVoiceResponsePolicy({
      ...baseInput,
      inboundTransport: 'telegram_voice',
      detectedIntent: 'guest_property_question',
      domainZone: 'core',
      now: new Date('2026-06-20T10:00:00.000Z'),
    });
    expect(decision.shouldSendVoice).toBe(true);
    expect(decision.reason).toBe('inbound_voice_allowed');
  });

  it('disables inbound voice for adjacent restaurant when policy requires core only', () => {
    const decision = evaluateVoiceResponsePolicy({
      ...baseInput,
      inboundTransport: 'telegram_voice',
      detectedIntent: 'guest_local_recommendation',
      domainZone: 'adjacent',
      propertyVoiceSettings: {
        ...DEFAULT_PROPERTY_VOICE_POLICY,
        voiceForAllInboundVoice: false,
      },
      now: new Date('2026-06-20T10:00:00.000Z'),
    });
    expect(decision.shouldSendVoice).toBe(false);
    expect(decision.reason).toBe('not_needed');
  });

  it('disables voice for out-of-domain', () => {
    const decision = evaluateVoiceResponsePolicy({
      ...baseInput,
      domainZone: 'out_of_domain',
      detectedIntent: 'lead_connection',
    });
    expect(decision.shouldSendVoice).toBe(false);
    expect(decision.reason).toBe('out_of_domain');
  });

  it('disables voice for prompt injection risk', () => {
    const decision = evaluateVoiceResponsePolicy({
      ...baseInput,
      messageRisk: 'prompt_injection',
      detectedIntent: 'guest_checkin',
      domainZone: 'core',
    });
    expect(decision.shouldSendVoice).toBe(false);
    expect(decision.reason).toBe('sensitive_internal');
  });

  it('disables voice when user turned voice off', () => {
    const decision = evaluateVoiceResponsePolicy({
      ...baseInput,
      detectedIntent: 'emergency_or_damage',
      isUrgent: true,
      userVoiceSettings: { voiceRepliesEnabled: false, voiceNoticeSent: true },
    });
    expect(decision.shouldSendVoice).toBe(false);
    expect(decision.reason).toBe('disabled_by_user');
  });

  it('disables voice when budget cap reached', () => {
    const decision = evaluateVoiceResponsePolicy({
      ...baseInput,
      detectedIntent: 'emergency_or_damage',
      isUrgent: true,
      budget: {
        dailyReplyCount: 30,
        dailyEstimatedSeconds: 900,
        monthlyEstimatedSeconds: 0,
        dailyCapReached: true,
        monthlyCapReached: false,
      },
    });
    expect(decision.shouldSendVoice).toBe(false);
    expect(decision.reason).toBe('budget_cap_reached');
  });

  it('reports tts_missing_env without crashing', () => {
    const decision = evaluateVoiceResponsePolicy({
      ...baseInput,
      detectedIntent: 'emergency_or_damage',
      isUrgent: true,
      ttsConfigured: false,
    });
    expect(decision.shouldSendVoice).toBe(false);
    expect(decision.reason).toBe('tts_missing_env');
  });

  it('uses timezone fallback metadata', () => {
    const decision = evaluateVoiceResponsePolicy({
      ...baseInput,
      detectedIntent: 'guest_checkin',
      domainZone: 'core',
      now: new Date('2026-06-20T20:30:00.000Z'),
      propertyTimezone: resolvePropertyTimezone(null),
    });
    expect(decision.timezoneSource).toBe('fallback');
  });
});

describe('prepareVoiceTextForTts', () => {
  it('shortens long answers and strips markdown', () => {
    const long = `# Заголовок\n\n**Wi-Fi**: сеть ASI, пароль 1234.\n\n`.repeat(20);
    const voiceText = prepareVoiceTextForTts(long, 700);
    expect(voiceText.length).toBeLessThanOrEqual(700);
    expect(voiceText).not.toContain('**');
    expect(voiceText).not.toContain('#');
  });

  it('does not include internal ids in voice text', () => {
    const voiceText = prepareVoiceTextForTts('reviewId=abc123def456 Wi-Fi работает.', 700);
    expect(voiceText.toLowerCase()).not.toContain('reviewid');
    expect(voiceText).not.toMatch(/abc123def456/i);
  });
});

describe('property timezone helpers', () => {
  it('falls back to Europe/Moscow for unknown timezone', () => {
    const resolved = resolvePropertyTimezone('Not/A/Timezone');
    expect(resolved.timezone).toBe('Europe/Moscow');
    expect(resolved.timezoneSource).toBe('fallback');
  });

  it('detects night window crossing midnight', () => {
    expect(isWithinNightWindow({ hours: 23, minutes: 30 }, '22:00', '08:00')).toBe(true);
    expect(isWithinNightWindow({ hours: 12, minutes: 0 }, '22:00', '08:00')).toBe(false);
  });

  it('reads local time parts for IANA timezone', () => {
    const parts = getLocalTimeParts('Europe/Moscow', new Date('2026-06-20T20:30:00.000Z'));
    expect(parts.hours).toBe(23);
    expect(parts.minutes).toBe(30);
  });
});
