import { afterEach, describe, it, expect, vi } from 'vitest';
import { evaluateActionSafety } from '../action';
import { CommunicationContext, EscalationReason, IntentCategory } from '../types';
import { getChannelAdapter } from '../channels';
import {
  COMMUNICATION_CHANNEL_FOUNDATION,
  getCommunicationChannelFoundation,
} from '../channel-foundation';

const mockReplyToTelegram = vi.fn().mockResolvedValue(true);
vi.mock('../../telegram', () => ({
  replyToTelegram: (...args: unknown[]) => mockReplyToTelegram(...args),
}));

describe('Channel Adapters', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mockReplyToTelegram.mockClear();
  });

  const guestContext = (confidence: number): CommunicationContext => ({
    chatId: 4242,
    memory: { role: 'guest', lastMessageAt: new Date('2026-01-01T00:00:00Z') },
    intentResult: { intent: IntentCategory.GeneralQuestion, confidence },
    reservation: { status: 'matched', confidence: 1 },
    knowledge: { universalPolicy: 'Never fabricate property information.' },
    recentMessages: [],
  });

  it.each([NaN, Infinity, -Infinity, -0.1, 1.1])(
    'routes invalid intent confidence %s to operator without mutating context',
    (confidence) => {
      const context = guestContext(confidence);
      const before = structuredClone(context);
      expect(evaluateActionSafety(context, 'Здравствуйте')).toEqual({
        safe: false,
        action: 'escalate_to_operator',
        reason: 'Intent confidence is invalid. Operator review required.',
        escalationReason: EscalationReason.LowIntentConfidence,
      });
      expect(context).toEqual(before);
    },
  );

  it('keeps emergency escalation ahead of invalid classifier confidence', () => {
    expect(evaluateActionSafety(guestContext(NaN), 'fire in kitchen')).toMatchObject({
      safe: false,
      action: 'escalate_to_operator',
      escalationReason: EscalationReason.UrgentIssue,
    });
  });

  it('never sends a guest message through Telegram during a no-send dry-run', async () => {
    vi.stubEnv('ASI_SYNTHETIC_NO_SEND', 'YES');
    // Keep this regression entirely in memory, including when run in synthetic CI.
    vi.stubEnv('STRIGUNOV_SYNTHETIC_ONLY', 'NO');
    mockReplyToTelegram.mockClear();
    const context = guestContext(0.9);
    expect(evaluateActionSafety(context, 'Здравствуйте')).toMatchObject({
      safe: true,
      action: 'send_informational_reply',
    });
    await expect(
      getChannelAdapter('telegram').sendMessage(String(context.chatId), 'Здравствуйте!'),
    ).rejects.toThrow('external_effects_disabled');
    expect(mockReplyToTelegram).not.toHaveBeenCalled();
  });

  it('formats telegram responses tightly', () => {
    const adapter = getChannelAdapter('telegram');
    const result = adapter.formatResponse('  Hello! We have received your request.  ', {});
    expect(result).toBe('Hello! We have received your request.');
  });

  it('passes Telegram reply keyboard markup through to sendMessage payload', async () => {
    mockReplyToTelegram.mockClear();
    const adapter = getChannelAdapter('telegram');

    const sent = await adapter.sendMessage('4242', 'Здравствуйте!', {
      reply_handler: 'test:unknown_identity',
      update_id: 123,
      reply_markup: {
        keyboard: [
          ['Я гость', 'Я владелец/управляющий'],
          ['Хочу подключить ASI', 'Проблема по объекту'],
        ],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });

    expect(sent).toBe(true);
    expect(mockReplyToTelegram).toHaveBeenCalledWith(
      4242,
      'Здравствуйте!',
      expect.objectContaining({
        handler: 'test:unknown_identity',
        update_id: 123,
        reply_markup: expect.objectContaining({
          keyboard: [
            ['Я гость', 'Я владелец/управляющий'],
            ['Хочу подключить ASI', 'Проблема по объекту'],
          ],
        }),
      }),
    );
  });

  it('formats email responses with professional signatures', () => {
    const adapter = getChannelAdapter('email');
    const result = adapter.formatResponse('Hello! We have received your request.', {});
    const expectedFrom = process.env.EMAIL_FROM_ADDRESS ?? process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? 'support@asi-global.ru';
    expect(result).toContain('Best regards');
    expect(result).toContain(expectedFrom);
  });

  it('formats phone responses as operator summaries', () => {
    const adapter = getChannelAdapter('phone');
    const result = adapter.formatResponse('Guest needs towels.', {});
    expect(result).toContain('[Call Follow-up');
    expect(result).toContain('Guest needs towels.');
  });

  it('lists phone as a planned first-class communication channel', () => {
    const channels = COMMUNICATION_CHANNEL_FOUNDATION.map((item) => item.channel);
    const phone = getCommunicationChannelFoundation('phone');

    expect(channels).toEqual(['telegram', 'email', 'phone']);
    expect(getChannelAdapter('telegram').channel).toBe('telegram');
    expect(getChannelAdapter('email').channel).toBe('email');
    expect(getChannelAdapter('phone').channel).toBe('phone');
    expect(phone).toEqual(
      expect.objectContaining({
        channel: 'phone',
        labelRu: 'Телефон',
        modeRu: 'Голосовые звонки',
        dashboardBadgeRu: 'Следующий этап: подключение телефонии',
        readiness: 'planned',
        providerStatus: 'not_connected',
      }),
    );
  });

  it('returns valid Max stub', () => {
    const adapter = getChannelAdapter('max');
    expect(adapter.channel).toBe('max');
  });
});
