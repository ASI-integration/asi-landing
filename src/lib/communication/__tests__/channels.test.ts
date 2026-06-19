import { describe, it, expect, vi } from 'vitest';
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
