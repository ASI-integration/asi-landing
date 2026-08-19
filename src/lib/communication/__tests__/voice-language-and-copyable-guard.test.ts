import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  containsCopyableGuestData,
  evaluateVoiceResponsePolicy,
} from '../voice-response-policy';
import { DEFAULT_PROPERTY_VOICE_POLICY } from '../voice-response-settings';
import { resolvePropertyTimezone } from '../property-timezone';
import { OPENROUTER_TRANSCRIPTION_PROMPT } from '../voice/stt';

const budget = {
  dailyReplyCount: 0,
  dailyEstimatedSeconds: 0,
  monthlyEstimatedSeconds: 0,
  dailyCapReached: false,
  monthlyCapReached: false,
};

describe('voice language and copyable-data guard regressions', () => {
  it('instructs OpenRouter STT to preserve the original spoken language instead of translating', () => {
    expect(OPENROUTER_TRANSCRIPTION_PROMPT).toMatch(/original spoken language/i);
    expect(OPENROUTER_TRANSCRIPTION_PROMPT).toMatch(/do not translate/i);
    expect(OPENROUTER_TRANSCRIPTION_PROMPT).toMatch(/Russian Cyrillic/i);
  });

  it('does not treat a request for a booking number as copyable outbound data', () => {
    expect(containsCopyableGuestData(
      'Please send the property or booking number so I can check the exact details.',
    )).toBe(false);
    expect(containsCopyableGuestData(
      'Пришлите, пожалуйста, номер бронирования, чтобы я могла проверить детали.',
    )).toBe(false);
  });

  it('still keeps actual booking identifiers text-only', () => {
    expect(containsCopyableGuestData('Booking number: ABC123')).toBe(true);
    expect(containsCopyableGuestData('Номер бронирования: AB1234')).toBe(true);
  });

  it('allows a safe booking-context clarification to be voiced after a voice inbound', () => {
    const decision = evaluateVoiceResponsePolicy({
      inboundTransport: 'telegram_voice',
      userVoiceSettings: {
        voiceRepliesEnabled: true,
        voiceNoticeSent: false,
        preferredResponseModality: null,
      },
      propertyVoiceSettings: { ...DEFAULT_PROPERTY_VOICE_POLICY },
      budget,
      replyText: 'Пришлите, пожалуйста, номер бронирования, чтобы я могла проверить детали.',
      ttsConfigured: true,
      propertyTimezone: resolvePropertyTimezone('Europe/Moscow'),
      role: 'guest',
      detectedIntent: 'guest_booking_lookup',
      domainZone: 'core',
      responseMode: 'ask_clarifying_question',
    });

    expect(decision.shouldSendVoice).toBe(true);
    expect(decision.reason).toBe('inbound_voice_allowed');
  });

  it('wires voice-response metadata into the communication autopilot v1 direct outbound path', () => {
    const source = readFileSync(
      new URL('../communication-autopilot-v1-orchestrator.ts', import.meta.url),
      'utf8',
    );

    expect(source).toMatch(/buildVoiceOutboundMetadata/);
    expect(source).toMatch(/\.\.\.voiceMetadata/);
    expect(source).toMatch(/ask_clarifying_question/);
  });
});
