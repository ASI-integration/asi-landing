import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetForTesting } from '../idempotency';
import { ProcessOutcome, type TelegramUpdate } from '../types';
import { __resetAutonomousSessionStoreForTests } from '../conversation-session-store';

const mockSendMessage = vi.fn().mockResolvedValue(true);
const mockEditMarkup = vi.fn().mockResolvedValue(true);
const mockEditText = vi.fn().mockResolvedValue(true);
const mockAnswerCallback = vi.fn().mockResolvedValue(true);

function supabaseQuery(table: string) {
  const query: any = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    update: vi.fn(() => ({
      eq: async () => ({ data: null, error: null }),
    })),
    insert: vi.fn(() => ({
      select: () => ({
        single: async () => ({ data: { id: 'crm-created' }, error: null }),
      }),
    })),
  };
  return query;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => supabaseQuery(table),
  },
}));

vi.mock('../channels', () => ({
  getChannelAdapter: () => ({
    sendMessage: (...args: unknown[]) => mockSendMessage(...args),
    formatResponse: (rawMessage: string) => rawMessage,
  }),
}));

vi.mock('@/lib/telegram', () => ({
  replyToTelegram: (...args: unknown[]) => mockSendMessage(...args),
  answerTelegramCallbackQuery: (...args: unknown[]) => mockAnswerCallback(...args),
  editTelegramMessageReplyMarkup: (...args: unknown[]) => mockEditMarkup(...args),
  editTelegramMessageText: (...args: unknown[]) => mockEditText(...args),
}));

vi.mock('@/lib/openai', () => ({
  callLLM: vi.fn().mockResolvedValue('LLM reply'),
}));

vi.mock('../intent', () => ({
  detectIntent: async () => ({ intent: 'general_question', confidence: 0.95 }),
}));

vi.mock('../autopilot', () => ({
  decideAutopilot: vi.fn(),
  buildAutopilotContext: vi.fn(),
}));

function wizardCallbackUpdate(data: string, chatId: number, messageId = 501): TelegramUpdate {
  return {
    update_id: 80_000 + messageId,
    callback_query: {
      id: `cb-${data}-${messageId}`,
      from: { id: chatId, language_code: 'ru', username: 'wizard_owner' },
      message: {
        message_id: messageId,
        chat: { id: chatId },
        from: { id: 100, is_bot: true, first_name: 'ASI Support' },
        text: 'Шаг выбора каналов',
      },
      data,
    },
  };
}

function textUpdate(text: string, chatId: number, messageId: number): TelegramUpdate {
  return {
    update_id: 70_000 + messageId,
    message: {
      message_id: messageId,
      chat: { id: chatId },
      from: { id: chatId, language_code: 'ru', username: 'wizard_owner' },
      text,
    },
  };
}

async function walkToChannelsStep(chatId: number): Promise<void> {
  const { processUpdate } = await import('../orchestrator');
  await processUpdate(textUpdate('Хочу подключить квартиру', chatId, 1));
  await processUpdate(textUpdate('Санкт-Петербург, Лиговский пр., 108', chatId, 2));
  await processUpdate(wizardCallbackUpdate('obv2:type:Квартира', chatId, 3));
  await processUpdate(wizardCallbackUpdate('obv2:chk_in:14:00', chatId, 4));
  await processUpdate(wizardCallbackUpdate('obv2:chk_out:12:00', chatId, 5));
}

describe('Telegram wizard v2 multi-select orchestrator delivery', () => {
  beforeEach(() => {
    _resetForTesting();
    __resetAutonomousSessionStoreForTests();
    mockSendMessage.mockClear();
    mockEditMarkup.mockClear();
    mockEditText.mockClear();
    mockAnswerCallback.mockClear();
    mockSendMessage.mockResolvedValue(true);
    mockEditMarkup.mockResolvedValue(true);
    mockEditText.mockResolvedValue(true);
    mockAnswerCallback.mockResolvedValue(true);
  });

  it('edits callback message markup on channel toggle without sendMessage', async () => {
    const chatId = 7401;
    await walkToChannelsStep(chatId);
    mockSendMessage.mockClear();
    mockEditMarkup.mockClear();

    const { processUpdate } = await import('../orchestrator');
    const result = await processUpdate(wizardCallbackUpdate('obv2:ch_t:sutochno', chatId, 6));

    expect(result.outcome).toBe(ProcessOutcome.Replied);
    expect(mockAnswerCallback).toHaveBeenCalled();
    expect(mockEditMarkup).toHaveBeenCalledTimes(1);
    expect(mockEditText).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockEditMarkup.mock.calls[0]?.[2]).toMatchObject({
      inline_keyboard: expect.arrayContaining([
        expect.arrayContaining([expect.objectContaining({ text: '✅ Суточно' })]),
      ]),
    });
  });

  it('keeps multiple selected channels in one edited message markup', async () => {
    const chatId = 7402;
    await walkToChannelsStep(chatId);
    const { processUpdate } = await import('../orchestrator');
    await processUpdate(wizardCallbackUpdate('obv2:ch_t:sutochno', chatId, 6));

    mockSendMessage.mockClear();
    mockEditMarkup.mockClear();
    await processUpdate(wizardCallbackUpdate('obv2:ch_t:avito', chatId, 6));

    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockEditMarkup).toHaveBeenCalledTimes(1);
    const labels = (mockEditMarkup.mock.calls[0]?.[2] as { inline_keyboard?: Array<Array<{ text?: string }>> } | undefined)
      ?.inline_keyboard?.flat()
      .map((button) => button.text);
    expect(labels).toEqual(expect.arrayContaining(['✅ Суточно', '✅ Авито', 'Готово']));
  });

  it('sends a new message when channels are confirmed with "Готово"', async () => {
    const chatId = 7403;
    await walkToChannelsStep(chatId);
    const { processUpdate } = await import('../orchestrator');
    await processUpdate(wizardCallbackUpdate('obv2:ch_t:sutochno', chatId, 6));

    mockSendMessage.mockClear();
    mockEditMarkup.mockClear();
    const result = await processUpdate(wizardCallbackUpdate('obv2:ch_done', chatId, 6));

    expect(result.outcome).toBe(ProcessOutcome.Replied);
    expect(mockEditMarkup).not.toHaveBeenCalled();
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(String(mockSendMessage.mock.calls[0]?.[1] ?? '')).toMatch(/правил/i);
  });

  it('edits callback message markup on rule toggle without sendMessage', async () => {
    const chatId = 7404;
    await walkToChannelsStep(chatId);
    const { processUpdate } = await import('../orchestrator');
    await processUpdate(wizardCallbackUpdate('obv2:ch_t:sutochno', chatId, 6));
    await processUpdate(wizardCallbackUpdate('obv2:ch_done', chatId, 6));

    mockSendMessage.mockClear();
    mockEditMarkup.mockClear();
    const result = await processUpdate(wizardCallbackUpdate('obv2:rl_t:no_smoke', chatId, 7));

    expect(result.outcome).toBe(ProcessOutcome.Replied);
    expect(mockEditMarkup).toHaveBeenCalledTimes(1);
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockEditMarkup.mock.calls[0]?.[2]).toMatchObject({
      inline_keyboard: expect.arrayContaining([
        expect.arrayContaining([expect.objectContaining({ text: '✅ Не курить' })]),
      ]),
    });
  });

  it('falls back to sendMessage when editMessageReplyMarkup fails', async () => {
    const chatId = 7405;
    await walkToChannelsStep(chatId);
    mockEditMarkup.mockResolvedValueOnce(false);

    const { processUpdate } = await import('../orchestrator');
    mockSendMessage.mockClear();
    const result = await processUpdate(wizardCallbackUpdate('obv2:ch_t:sutochno', chatId, 6));

    expect(result.outcome).toBe(ProcessOutcome.Replied);
    expect(mockEditMarkup).toHaveBeenCalledTimes(1);
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  it('returns to channel markup after custom channel text without editMessageReplyMarkup spam', async () => {
    const chatId = 7406;
    await walkToChannelsStep(chatId);
    const { processUpdate } = await import('../orchestrator');
    await processUpdate(wizardCallbackUpdate('obv2:ch_custom', chatId, 6));

    mockSendMessage.mockClear();
    mockEditMarkup.mockClear();
    mockEditText.mockClear();

    const result = await processUpdate(textUpdate('TravelLine', chatId, 7));

    expect(result.outcome).toBe(ProcessOutcome.Replied);
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockEditMarkup).not.toHaveBeenCalled();
    expect(String(mockSendMessage.mock.calls[0]?.[1] ?? '')).toMatch(/канал/i);
    expect(
      (
        mockSendMessage.mock.calls[0]?.[2] as
          | { reply_markup?: { inline_keyboard?: Array<Array<{ text?: string }>> } }
          | undefined
      )?.reply_markup?.inline_keyboard
        ?.flat()
        .map((button) => button.text),
    ).toEqual(expect.arrayContaining(['✅ TravelLine', 'Готово']));
  });
});
