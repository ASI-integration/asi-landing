import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetAutonomousSessionStoreForTests,
  patchAutonomousSessionCollectedData,
} from '../conversation-session-store';
import { buildVoiceOutboundMetadata } from '../voice-outbound';
import { evaluateVoiceResponsePolicy } from '../voice-response-policy';
import {
  DEFAULT_PROPERTY_VOICE_POLICY,
  loadChatVoiceUserSettings,
} from '../voice-response-settings';
import { resolvePropertyTimezone } from '../property-timezone';

const budget = {
  dailyReplyCount: 0,
  dailyEstimatedSeconds: 0,
  monthlyEstimatedSeconds: 0,
  dailyCapReached: false,
  monthlyCapReached: false,
};

describe('Telegram response modality preference', () => {
  beforeEach(() => {
    __resetAutonomousSessionStoreForTests();
  });

  it('treats explicit /voice_on and /voice_off state as a saved modality preference', () => {
    expect(loadChatVoiceUserSettings({ voice_replies_enabled: 'true' })).toMatchObject({
      voiceRepliesEnabled: true,
      preferredResponseModality: 'voice',
    });
    expect(loadChatVoiceUserSettings({ voice_replies_enabled: 'false' })).toMatchObject({
      voiceRepliesEnabled: false,
      preferredResponseModality: 'text',
    });
    expect(loadChatVoiceUserSettings({})).toMatchObject({
      voiceRepliesEnabled: true,
      preferredResponseModality: null,
    });
  });

  it('uses saved voice preference even when the next guest turn is text', () => {
    const decision = evaluateVoiceResponsePolicy({
      inboundTransport: 'telegram_text',
      userVoiceSettings: {
        voiceRepliesEnabled: true,
        voiceNoticeSent: false,
        preferredResponseModality: 'voice',
      },
      propertyVoiceSettings: { ...DEFAULT_PROPERTY_VOICE_POLICY },
      budget,
      replyText: 'Правила проживания: соблюдать тишину после двадцати двух часов.',
      ttsConfigured: true,
      propertyTimezone: resolvePropertyTimezone('Europe/Moscow'),
      role: 'guest',
      detectedIntent: 'guest_rules_question',
      domainZone: 'core',
      responseMode: 'answer_from_property',
      now: new Date('2026-08-19T10:00:00.000Z'),
    });

    expect(decision.shouldSendVoice).toBe(true);
    expect(decision.reason).toBe('preferred_voice');
  });

  it('keeps saved text preference text-only even after an inbound voice turn', () => {
    const decision = evaluateVoiceResponsePolicy({
      inboundTransport: 'telegram_voice',
      userVoiceSettings: {
        voiceRepliesEnabled: false,
        voiceNoticeSent: false,
        preferredResponseModality: 'text',
      },
      propertyVoiceSettings: { ...DEFAULT_PROPERTY_VOICE_POLICY },
      budget,
      replyText: 'Правила проживания: соблюдать тишину после двадцати двух часов.',
      ttsConfigured: true,
      propertyTimezone: resolvePropertyTimezone('Europe/Moscow'),
      role: 'guest',
      detectedIntent: 'guest_rules_question',
      domainZone: 'core',
      responseMode: 'answer_from_property',
    });

    expect(decision.shouldSendVoice).toBe(false);
    expect(decision.reason).toBe('disabled_by_user');
  });

  it('offers the modality choice once on a safe first text reply', () => {
    const envelope = {
      channel: 'telegram' as const,
      chatId: 42,
      externalUserId: '42',
      messageText: 'Во сколько выезд?',
      receivedAt: new Date(),
      metadata: { originalMessageType: 'text' },
    };

    const first = buildVoiceOutboundMetadata({
      envelope,
      chatId: 42,
      replyText: 'Выезд до 12:00.',
      role: 'guest',
      detectedIntent: 'guest_property_question',
      domainZone: 'core',
      responseMode: 'answer_from_property',
    });
    expect(first.response_modality_prompt).toBe(true);

    patchAutonomousSessionCollectedData({
      chatId: 42,
      channel: 'telegram',
      set: { response_modality_prompt_sent: 'true' },
    });
    const second = buildVoiceOutboundMetadata({
      envelope,
      chatId: 42,
      replyText: 'Выезд до 12:00.',
      role: 'guest',
      detectedIntent: 'guest_property_question',
      domainZone: 'core',
      responseMode: 'answer_from_property',
    });
    expect(second.response_modality_prompt).toBe(false);
  });

  it('never appends the preference question to urgent or operator handoff replies', () => {
    const envelope = {
      channel: 'telegram' as const,
      chatId: 43,
      externalUserId: '43',
      messageText: 'Замок сломан, не могу войти.',
      receivedAt: new Date(),
      metadata: { originalMessageType: 'text' },
    };
    const metadata = buildVoiceOutboundMetadata({
      envelope,
      chatId: 43,
      replyText: 'Передала вопрос оператору.',
      role: 'guest',
      detectedIntent: 'urgent_access_problem',
      domainZone: 'core',
      responseMode: 'operator_escalation',
      isUrgent: true,
      isEscalation: true,
    });
    expect(metadata.response_modality_prompt).toBe(false);
  });
});
