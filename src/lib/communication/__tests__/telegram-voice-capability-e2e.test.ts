import { afterEach, describe, expect, it } from 'vitest';
import { resolveCommunicationIdentityRoute } from '../communication-identity-routing';
import { __resetAutonomousSessionStoreForTests } from '../conversation-session-store';
import { resolveVoiceResponseDecision } from '../voice-outbound';

function voiceEnvelope(text: string) {
  return {
    channel: 'telegram',
    chatId: 931919812,
    messageText: text,
    metadata: {
      telegram_chat_id: 931919812,
      telegram_user_language_code: 'ru',
      originalMessageType: 'voice',
      voice: { originalMessageType: 'voice' },
    },
  } as any;
}

describe('Telegram voice capability E2E routing', () => {
  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.VOICE_TTS_PROVIDER;
    __resetAutonomousSessionStoreForTests();
  });

  it('bypasses the identity prompt for a capability-only voice transcript', async () => {
    const route = await resolveCommunicationIdentityRoute({
      envelope: voiceEnvelope('Ты слышишь меня? Ответь, пожалуйста, по-русски.'),
      identity: {
        role: 'unknown',
        status: 'unresolved',
        confidence: 0,
        reason: 'no_binding',
        resolutionPath: [],
      } as any,
    });

    expect(route.route).toBe('guest_concierge');
    expect(route.shouldRunGuestConcierge).toBe(true);
    expect(route.replyText).toBeUndefined();
    expect(route.reason).toBe('telegram_meta_identity_free');
  });

  it('allows TTS for a safe inbound voice capability reply without property context', () => {
    process.env.VOICE_TTS_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'test-key';

    const decision = resolveVoiceResponseDecision({
      envelope: voiceEnvelope('Ты слышишь меня? Ответь, пожалуйста, по-русски.'),
      replyText: 'Да, слышу и понимаю вас. Понимаю русский и английский. Можете говорить или писать.',
      chatId: 931919812,
    });

    expect(decision.shouldSendVoice).toBe(true);
    expect(decision.reason).toBe('inbound_voice_allowed');
    expect(decision.voiceText).toMatch(/слышу и понимаю/i);
  });
});
