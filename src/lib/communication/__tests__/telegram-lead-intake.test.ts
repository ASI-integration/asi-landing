import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tgTextUpdate } from '../dev/telegram-fixtures';

type MockLeadRow = {
  id: string;
  telegram_user_id: string;
  telegram_username: string | null;
  first_name: string | null;
  source: string;
  answers_json: Record<string, any>;
  status: string;
  created_at: string;
  updated_at: string;
};

const mockDb = {
  rows: [] as MockLeadRow[],
  nextId: 1,
};

const mockReplyToTelegram = vi.fn();
const mockSendTelegramMessageToChat = vi.fn();
const mockEditTelegramMessageText = vi.fn();
const mockAnswerTelegramCallbackQuery = vi.fn();
const mockCallLLM = vi.fn();

vi.mock('@/lib/telegram', () => ({
  replyToTelegram: (...args: unknown[]) => mockReplyToTelegram(...args),
  sendTelegramMessageToChat: (...args: unknown[]) => mockSendTelegramMessageToChat(...args),
  editTelegramMessageText: (...args: unknown[]) => mockEditTelegramMessageText(...args),
  answerTelegramCallbackQuery: (...args: unknown[]) => mockAnswerTelegramCallbackQuery(...args),
}));

vi.mock('@/lib/openai', () => ({
  callLLM: (...args: unknown[]) => mockCallLLM(...args),
}));

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createQuery(table: string) {
  const state = {
    eq: [] as Array<[string, unknown]>,
    limit: 100,
    update: null as Record<string, unknown> | null,
    insert: null as Record<string, unknown> | null,
  };

  const api = {
    select: vi.fn(() => api),
    eq: vi.fn((column: string, value: unknown) => {
      state.eq.push([column, value]);
      return api;
    }),
    order: vi.fn(() => api),
    limit: vi.fn((value: number) => {
      state.limit = value;
      return Promise.resolve({
        data: mockDb.rows
          .filter((row) => state.eq.every(([column, expected]) => (row as any)[column] === expected))
          .slice(0, state.limit)
          .map(clone),
        error: null,
      });
    }),
    insert: vi.fn((value: Record<string, unknown>) => {
      state.insert = value;
      return api;
    }),
    update: vi.fn((value: Record<string, unknown>) => {
      state.update = value;
      return api;
    }),
    single: vi.fn(() => {
      if (state.insert) {
        const now = new Date().toISOString();
        const row: MockLeadRow = {
          id: `lead-${mockDb.nextId++}`,
          telegram_user_id: String(state.insert.telegram_user_id),
          telegram_username: (state.insert.telegram_username as string | null) ?? null,
          first_name: (state.insert.first_name as string | null) ?? null,
          source: String(state.insert.source ?? 'unknown'),
          answers_json: clone((state.insert.answers_json as Record<string, any>) ?? {}),
          status: String(state.insert.status ?? 'new'),
          created_at: now,
          updated_at: now,
        };
        mockDb.rows.unshift(row);
        return Promise.resolve({ data: clone(row), error: null });
      }

      if (state.update) {
        const id = state.eq.find(([column]) => column === 'id')?.[1];
        const row = mockDb.rows.find((candidate) => candidate.id === id);
        if (!row) return Promise.resolve({ data: null, error: { message: 'not found' } });
        Object.assign(row, clone(state.update));
        return Promise.resolve({ data: clone(row), error: null });
      }

      return Promise.resolve({ data: null, error: { message: `unsupported mock query for ${table}` } });
    }),
  };

  return api;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => createQuery(table),
  },
}));

import {
  parseAsiFeedbackStartSource,
  processTelegramLeadIntakeUpdate,
} from '../telegram-lead-intake';

function leadUpdate(text: string, update_id = 1000) {
  const update = tgTextUpdate({
    chat_id: 7001,
    user_id: 9001,
    update_id,
    message_id: update_id,
    text,
  });
  update.message!.from = {
    id: 9001,
    username: 'pilot_owner',
    first_name: 'Иван',
    language_code: 'ru',
  };
  return update;
}

function callbackUpdate(data: string, update_id: number) {
  return {
    update_id,
    callback_query: {
      id: `cb-${update_id}`,
      from: {
        id: 9001,
        username: 'pilot_owner',
        first_name: 'Иван',
        language_code: 'ru',
      },
      message: {
        message_id: update_id,
        chat: { id: 7001 },
      },
      data,
    },
  };
}

describe('ASI Feedback Telegram lead intake', () => {
  beforeEach(() => {
    mockDb.rows = [];
    mockDb.nextId = 1;
    mockReplyToTelegram.mockReset();
    mockSendTelegramMessageToChat.mockReset();
    mockEditTelegramMessageText.mockReset();
    mockAnswerTelegramCallbackQuery.mockReset();
    mockCallLLM.mockReset();
    mockReplyToTelegram.mockResolvedValue(true);
    mockSendTelegramMessageToChat.mockResolvedValue(true);
    mockEditTelegramMessageText.mockResolvedValue(true);
    mockAnswerTelegramCallbackQuery.mockResolvedValue(true);
    mockCallLLM.mockResolvedValue(null);
    process.env.ASI_FEEDBACK_BOT_TOKEN = 'feedback-token';
    process.env.ASI_FEEDBACK_ADMIN_CHAT_ID = '-100admin';
    process.env.LEAD_INTAKE_AI_MODEL = 'lead-model';
  });

  it('parses supported Telegram /start sources with unknown fallback', () => {
    expect(parseAsiFeedbackStartSource('/start site')).toBe('site');
    expect(parseAsiFeedbackStartSource('/start tenchat')).toBe('tenchat');
    expect(parseAsiFeedbackStartSource('/start dzen')).toBe('dzen');
    expect(parseAsiFeedbackStartSource('/start telegram_group')).toBe('telegram_group');
    expect(parseAsiFeedbackStartSource('/start partner')).toBe('partner');
    expect(parseAsiFeedbackStartSource('/start something_else')).toBe('unknown');
    expect(parseAsiFeedbackStartSource('hello')).toBeNull();
  });

  it('runs the v2 button flow with multi-select, other text normalization, and AI fallback', async () => {
    await processTelegramLeadIntakeUpdate(leadUpdate('/start tenchat', 1001));
    expect(mockDb.rows).toHaveLength(1);
    expect(mockDb.rows[0].source).toBe('tenchat');
    expect(mockDb.rows[0].answers_json.flow.step).toBe('menu');
    expect(mockReplyToTelegram.mock.calls[0]?.[1]).toContain('Выберите, что хотите сделать');
    expect(JSON.stringify(mockReplyToTelegram.mock.calls[0]?.[3])).toContain('Оставить заявку');
    expect(JSON.stringify(mockReplyToTelegram.mock.calls[0]?.[3])).toContain('Задать вопрос / поддержка');

    await processTelegramLeadIntakeUpdate(callbackUpdate('ali2:lead', 10015));
    expect(mockDb.rows[0].answers_json.flow.step).toBe('object_count');
    expect(mockEditTelegramMessageText.mock.calls[0]?.[2]).toContain('Сколько объектов');
    expect(JSON.stringify(mockReplyToTelegram.mock.calls[0]?.[3])).not.toContain('Овербукинг');

    await processTelegramLeadIntakeUpdate(callbackUpdate('ali2:s:object_count:6_20', 1002));
    await processTelegramLeadIntakeUpdate(callbackUpdate('ali2:t:object_types:houses', 1003));
    await processTelegramLeadIntakeUpdate(callbackUpdate('ali2:o:object_types', 1004));
    expect(mockDb.rows[0].answers_json.flow.awaiting_text_for).toBe('object_types');

    await processTelegramLeadIntakeUpdate(leadUpdate('таунхаусы', 1005));
    expect(mockDb.rows[0].answers_json.object_types).toContain('Дома / коттеджи');
    expect(mockDb.rows[0].answers_json.other_texts.object_types).toEqual(['таунхаусы']);

    await processTelegramLeadIntakeUpdate(callbackUpdate('ali2:d:object_types', 1006));
    await processTelegramLeadIntakeUpdate(callbackUpdate('ali2:t:channels:avito', 1007));
    await processTelegramLeadIntakeUpdate(callbackUpdate('ali2:t:channels:sutochno', 1008));
    await processTelegramLeadIntakeUpdate(callbackUpdate('ali2:d:channels', 1009));
    await processTelegramLeadIntakeUpdate(callbackUpdate('ali2:s:pms:bnovo', 1010));
    await processTelegramLeadIntakeUpdate(callbackUpdate('ali2:t:automation_processes:guest_messages', 1011));
    const automationMarkup = JSON.stringify(mockEditTelegramMessageText.mock.calls[mockEditTelegramMessageText.mock.calls.length - 1]?.[3]);
    expect(automationMarkup).toContain('Общение с гостями и автоответы');
    expect(automationMarkup).not.toContain('Повторяющиеся вопросы');
    await processTelegramLeadIntakeUpdate(callbackUpdate('ali2:t:automation_processes:checkin', 1012));
    await processTelegramLeadIntakeUpdate(callbackUpdate('ali2:d:automation_processes', 1013));
    const timeConsumersMarkup = JSON.stringify(mockEditTelegramMessageText.mock.calls[mockEditTelegramMessageText.mock.calls.length - 1]?.[3]);
    expect(timeConsumersMarkup).toContain('Переписка с гостями');
    expect(timeConsumersMarkup).toContain('Заселение и инструкции');
    expect(timeConsumersMarkup).toContain('Координация уборок');
    expect(timeConsumersMarkup).toContain('Обновление данных на площадках');
    expect(timeConsumersMarkup).toContain('Контроль цен и загрузки');
    expect(timeConsumersMarkup).toContain('Отчёты');
    expect(timeConsumersMarkup).toContain('Подключение новых объектов');
    expect(timeConsumersMarkup).toContain('Не понимаю, с чего начать');
    expect(timeConsumersMarkup).toContain('Другое');
    await processTelegramLeadIntakeUpdate(callbackUpdate('ali2:t:time_consumers:messages', 1014));
    await processTelegramLeadIntakeUpdate(callbackUpdate('ali2:t:time_consumers:cleaning', 1015));
    await processTelegramLeadIntakeUpdate(callbackUpdate('ali2:d:time_consumers', 1016));
    const result = await processTelegramLeadIntakeUpdate(callbackUpdate('ali2:skip', 1017));

    expect(result?.reply).toContain('Спасибо, заявку получил');
    expect(mockDb.rows[0].answers_json).toMatchObject({
      object_count_range: '6-20',
      object_types: ['Дома / коттеджи'],
      channels: ['Авито', 'Суточно'],
      pms: ['Bnovo'],
      automation_processes: ['Общение с гостями и автоответы', 'Инструкции по заселению'],
      time_consumers: ['Переписка с гостями', 'Координация уборок'],
      ai_normalized: {
        object_types: ['Дома / коттеджи'],
        channels: ['Авито', 'Суточно'],
      },
      lead_potential: 'высокий',
      recommended_next_step: 'предложить демо коммуникационного модуля',
      flow: { step: 'completed' },
    });
    expect(mockDb.rows[0].answers_json.ai_summary).toContain('Объектов: 6-20');
    expect(mockCallLLM).toHaveBeenCalledWith(expect.objectContaining({ model: 'lead-model' }));
    expect(mockEditTelegramMessageText).toHaveBeenCalledWith(
      7001,
      expect.any(Number),
      expect.stringContaining('Выбрано: Дома / коттеджи'),
      expect.objectContaining({
        replyMarkup: expect.objectContaining({
          inline_keyboard: expect.arrayContaining([
            expect.arrayContaining([
              expect.objectContaining({ text: expect.stringContaining('✓ Дома / коттеджи') }),
            ]),
          ]),
        }),
      }),
    );
    expect(mockSendTelegramMessageToChat).toHaveBeenCalledWith(
      '-100admin',
      expect.stringContaining('Новая заявка ASI'),
      { botToken: 'feedback-token', tokenLabel: 'ASI_FEEDBACK_BOT_TOKEN' },
    );
    expect(mockSendTelegramMessageToChat.mock.calls[0]?.[1]).toContain('Типы объектов: Дома / коттеджи');
    expect(mockSendTelegramMessageToChat.mock.calls[0]?.[1]).toContain('AI-сводка:');
    expect(mockAnswerTelegramCallbackQuery).toHaveBeenCalled();
  });

  it('normalizes legacy guest communication process duplicates before admin summary', async () => {
    const now = new Date().toISOString();
    mockDb.rows.unshift({
      id: 'legacy-lead',
      telegram_user_id: '9001',
      telegram_username: 'pilot_owner',
      first_name: 'Иван',
      source: 'site',
      answers_json: {
        source: 'site',
        object_count_range: '2-5',
        object_types: ['Квартиры'],
        channels: ['Авито'],
        pms: ['Bnovo'],
        automation_processes: ['Общение с гостями', 'Повторяющиеся вопросы', 'Инструкции по заселению'],
        time_consumers: ['Переписка с гостями'],
        other_texts: {},
        flow: { step: 'comment' },
      },
      status: 'new',
      created_at: now,
      updated_at: now,
    });

    await processTelegramLeadIntakeUpdate(callbackUpdate('ali2:skip', 2001));

    expect(mockDb.rows[0].answers_json.automation_processes).toEqual([
      'Общение с гостями и автоответы',
      'Инструкции по заселению',
    ]);
    expect(mockDb.rows[0].answers_json.ai_normalized.automation_processes).toEqual([
      'Общение с гостями и автоответы',
      'Инструкции по заселению',
    ]);
    expect(mockDb.rows[0].answers_json.ai_summary).toContain('Общение с гостями и автоответы');
    expect(mockDb.rows[0].answers_json.ai_summary).not.toContain('Повторяющиеся вопросы');
    expect(mockSendTelegramMessageToChat.mock.calls[0]?.[1]).toContain('Что хочет автоматизировать: Общение с гостями и автоответы, Инструкции по заселению');
  });

  it('routes direct support deep link questions to the admin chat without AI auto-replies', async () => {
    const startResult = await processTelegramLeadIntakeUpdate(leadUpdate('/start support', 3001));

    expect(startResult?.reply).toContain('Напишите вопрос одним сообщением');
    expect(mockDb.rows).toHaveLength(1);
    expect(mockDb.rows[0].source).toBe('unknown');
    expect(mockDb.rows[0].answers_json).toMatchObject({
      source: 'support',
      flow: { step: 'support' },
    });
    expect(JSON.stringify(mockReplyToTelegram.mock.calls[0]?.[3])).toContain('Оставить заявку');
    expect(JSON.stringify(mockReplyToTelegram.mock.calls[0]?.[3])).toContain('Назад');

    const result = await processTelegramLeadIntakeUpdate(leadUpdate('Можно ли подключить RealtyCalendar?', 3002));

    expect(result?.reply).toContain('Спасибо, вопрос получил');
    expect(mockDb.rows[0].answers_json.flow.step).toBe('menu');
    expect(mockDb.rows[0].answers_json.support_requests).toHaveLength(1);
    expect(mockDb.rows[0].answers_json.support_requests[0]).toMatchObject({
      source: 'support',
      text: 'Можно ли подключить RealtyCalendar?',
      status: 'new',
      support_ai_intent: null,
      support_ai_summary: null,
      support_auto_reply_eligible: false,
    });
    expect(mockCallLLM).toHaveBeenCalledTimes(0);
    expect(mockSendTelegramMessageToChat).toHaveBeenCalledWith(
      '-100admin',
      expect.stringContaining('Новый вопрос в поддержку ASI'),
      { botToken: 'feedback-token', tokenLabel: 'ASI_FEEDBACK_BOT_TOKEN' },
    );
    const adminCard = String(mockSendTelegramMessageToChat.mock.calls[0]?.[1]);
    expect(adminCard).toContain('Источник: support');
    expect(adminCard).toContain('Имя: Иван');
    expect(adminCard).toContain('Username: @pilot_owner');
    expect(adminCard).toContain('Telegram ID: 9001');
    expect(adminCard).toContain('Текст вопроса: Можно ли подключить RealtyCalendar?');
    expect(adminCard).toContain('Пользователь: https://t.me/pilot_owner');
    expect(adminCard).toContain('Статус: new');
  });

  it('lets support return back to the lead questionnaire', async () => {
    await processTelegramLeadIntakeUpdate(leadUpdate('/start site', 3101));
    await processTelegramLeadIntakeUpdate(callbackUpdate('ali2:support', 3102));

    expect(mockDb.rows[0].answers_json.flow.step).toBe('support');
    expect(mockReplyToTelegram.mock.calls[mockReplyToTelegram.mock.calls.length - 1]?.[1]).toContain('Напишите вопрос одним сообщением');

    await processTelegramLeadIntakeUpdate(callbackUpdate('ali2:lead', 3103));

    expect(mockDb.rows[0].answers_json.flow.step).toBe('object_count');
    expect(mockEditTelegramMessageText.mock.calls[mockEditTelegramMessageText.mock.calls.length - 1]?.[2]).toContain('Сколько объектов');
  });

  it('adds completed lead context to later support requests', async () => {
    const now = new Date().toISOString();
    mockDb.rows.unshift({
      id: 'completed-lead',
      telegram_user_id: '9001',
      telegram_username: 'pilot_owner',
      first_name: 'Иван',
      source: 'site',
      answers_json: {
        source: 'site',
        object_count_range: '6-20',
        object_types: ['Квартиры'],
        pms: ['RealtyCalendar'],
        automation_processes: ['Общение с гостями и автоответы'],
        flow: { step: 'completed' },
      },
      status: 'new',
      created_at: now,
      updated_at: now,
    });

    await processTelegramLeadIntakeUpdate(leadUpdate('/support', 3201));
    await processTelegramLeadIntakeUpdate(leadUpdate('Можно ли подключить RealtyCalendar?', 3202));

    expect(mockDb.rows[0].answers_json.support_requests[0].lead_context).toMatchObject({
      object_count_range: '6-20',
      object_types: ['Квартиры'],
      pms: ['RealtyCalendar'],
      automation_processes: ['Общение с гостями и автоответы'],
    });
    const adminCard = String(mockSendTelegramMessageToChat.mock.calls[0]?.[1]);
    expect(adminCard).toContain('Контекст лида:');
    expect(adminCard).toContain('Объектов: 6-20');
    expect(adminCard).toContain('Тип объектов: Квартиры');
    expect(adminCard).toContain('PMS/МК: RealtyCalendar');
    expect(adminCard).toContain('Что хотел автоматизировать: Общение с гостями и автоответы');
  });
});
