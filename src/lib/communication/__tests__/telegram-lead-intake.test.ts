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

vi.mock('@/lib/telegram', () => ({
  replyToTelegram: (...args: unknown[]) => mockReplyToTelegram(...args),
  sendTelegramMessageToChat: (...args: unknown[]) => mockSendTelegramMessageToChat(...args),
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

describe('ASI Feedback Telegram lead intake', () => {
  beforeEach(() => {
    mockDb.rows = [];
    mockDb.nextId = 1;
    mockReplyToTelegram.mockReset();
    mockSendTelegramMessageToChat.mockReset();
    mockReplyToTelegram.mockResolvedValue(true);
    mockSendTelegramMessageToChat.mockResolvedValue(true);
    process.env.ASI_FEEDBACK_BOT_TOKEN = 'feedback-token';
    process.env.ASI_FEEDBACK_ADMIN_CHAT_ID = '-100admin';
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

  it('stores source at start and completes the five-question intake', async () => {
    await processTelegramLeadIntakeUpdate(leadUpdate('/start tenchat', 1001));
    expect(mockDb.rows).toHaveLength(1);
    expect(mockDb.rows[0].source).toBe('tenchat');
    expect(mockDb.rows[0].status).toBe('new');
    expect(mockDb.rows[0].answers_json.flow.step).toBe('object_count');

    await processTelegramLeadIntakeUpdate(leadUpdate('12', 1002));
    await processTelegramLeadIntakeUpdate(leadUpdate('квартиры и апартаменты', 1003));
    await processTelegramLeadIntakeUpdate(leadUpdate('Авито, Суточно, Циан', 1004));
    await processTelegramLeadIntakeUpdate(leadUpdate('сообщения гостей', 1005));
    const result = await processTelegramLeadIntakeUpdate(leadUpdate('Bnovo', 1006));

    expect(result?.reply).toContain('Спасибо, заявку получил');
    expect(mockDb.rows[0].answers_json).toMatchObject({
      object_count: '12',
      property_type: 'квартиры и апартаменты',
      channels: ['Авито', 'Суточно', 'Циан'],
      main_pain: 'сообщения гостей',
      pms: 'Bnovo',
      flow: { step: 'completed' },
      future_ai: {
        lead_scoring_ready: false,
        ai_summary_ready: false,
      },
    });
    expect(mockSendTelegramMessageToChat).toHaveBeenCalledWith(
      '-100admin',
      expect.stringContaining('Источник: tenchat'),
      { botToken: 'feedback-token', tokenLabel: 'ASI_FEEDBACK_BOT_TOKEN' },
    );
    expect(mockReplyToTelegram).toHaveBeenLastCalledWith(
      7001,
      expect.stringContaining('Спасибо, заявку получил'),
      expect.objectContaining({ handler: 'asi_feedback_lead_intake/completed' }),
      { botToken: 'feedback-token', tokenLabel: 'ASI_FEEDBACK_BOT_TOKEN' },
    );
  });
});
