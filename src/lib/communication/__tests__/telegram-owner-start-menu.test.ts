import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboundMessageEnvelope } from '../types';

const crmRows = new Map<string, Record<string, unknown>>();
const insertedRows: Array<Record<string, unknown>> = [];
const opsTaskCalls: Array<Record<string, unknown>> = [];

function makeQuery(table: string) {
  const query: any = {
    __field: '',
    __value: '',
    select: vi.fn(() => query),
    eq: vi.fn((field: string, value: unknown) => {
      query.__field = field;
      query.__value = String(value ?? '');
      return query;
    }),
    maybeSingle: vi.fn(async () => {
      if (table !== 'crm_contacts') return { data: null, error: null };
      const row = crmRows.get(`${query.__field}:${query.__value}`) ?? null;
      return { data: row, error: null };
    }),
    update: vi.fn((patch: Record<string, unknown>) => ({
      eq: async (_field: string, id: string) => {
        insertedRows.push({ table: `${table}_update`, id, patch });
        return { data: null, error: null };
      },
    })),
    insert: vi.fn((row: Record<string, unknown>) => {
      insertedRows.push({ table, row });
      const id = `crm-${insertedRows.length}`;
      if (table === 'crm_contacts') {
        const username = String(row.telegram_username ?? '');
        const contact = String(row.contact ?? '');
        const stored = { id, notes: row.notes ?? null };
        if (username) crmRows.set(`telegram_username:${username}`, stored);
        if (contact) crmRows.set(`contact:${contact}`, stored);
      }
      return {
        select: () => ({
          single: async () => ({ data: { id }, error: null }),
        }),
      };
    }),
  };
  return query;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => makeQuery(table),
  },
}));

vi.mock('@/lib/pilot-chain/orchestrator', () => ({
  runPilotChainForContact: vi.fn(async () => ({
    contactId: 'crm-1',
    objectId: 'OBJ-0001',
    steps: [],
    contact: null,
    opsTaskId: null,
  })),
}));

vi.mock('@/lib/ops-board/repository', () => ({
  buildAutoOpsDedupKey: vi.fn(
    (input: { source: string; sourceId: string; taskType: string }) =>
      `auto:${input.source}:${input.sourceId}:${input.taskType}`,
  ),
  createOpsOperatorTask: vi.fn(async (input: Record<string, unknown>) => {
    opsTaskCalls.push(input);
    return {
      ok: true,
      created: opsTaskCalls.length === 1,
      task: { id: `ops-${opsTaskCalls.length}` },
    };
  }),
}));

import { __resetAutonomousSessionStoreForTests } from '../conversation-session-store';
import { processTelegramOwnerOnboarding } from '../telegram-owner-onboarding';
import {
  ensureOwnerObjectsRegistry,
  listOwnerObjectRecords,
  persistOwnerObjectState,
  readOwnerObjectState,
} from '../telegram-owner-object-session';
import { START_MENU_CALLBACK_PREFIX } from '../telegram-owner-start-menu';

function envelope(messageText: string, extra?: Partial<InboundMessageEnvelope>): InboundMessageEnvelope {
  const { metadata: extraMetadata, ...restExtra } = extra ?? {};
  return {
    channel: 'telegram',
    externalUserId: '88001',
    chatId: '88001',
    messageText,
    receivedAt: new Date(),
    update_id: 88_001,
    metadata: {
      telegram_chat_id: '88001',
      telegram_user_id: 88001,
      telegram_username: 'owner_start_menu',
      telegram_first_name: 'Ирина',
      providerMessageId: `msg-${Math.random()}`,
      ...extraMetadata,
    },
    ...restExtra,
  };
}

function menuCb(data: string): InboundMessageEnvelope {
  return envelope('', { metadata: { telegram_start_menu_callback: data } });
}

function seedCompletedObject(chatId: number): void {
  ensureOwnerObjectsRegistry(chatId, 'telegram');
  const state = readOwnerObjectState(chatId, 'telegram', 'OBJ-0001');
  state.city = 'Санкт-Петербург';
  state.address = 'Невский проспект, 24';
  state.property_name = 'Апартаменты у Невского';
  state.object_type = 'Квартира';
  state.status = 'ready_for_channel_manager';
  state.mk_phase = 'completed';
  state.mk_route = 'no_cm';
  state.missing = [];
  persistOwnerObjectState(chatId, 'telegram', 'OBJ-0001', state);
}

describe('Telegram owner start menu and reset', () => {
  beforeEach(() => {
    __resetAutonomousSessionStoreForTests();
    crmRows.clear();
    insertedRows.length = 0;
    opsTaskCalls.length = 0;
  });

  it('shows main menu on greeting after completed session instead of old final status', async () => {
    seedCompletedObject(8801);

    const result = await processTelegramOwnerOnboarding({
      envelope: envelope('Здравствуйте'),
      chatId: 8801,
      senderIdentity: 'lead',
    });

    expect(result.replyText).toBe('Здравствуйте. Чем помочь?');
    expect(result.replyText).not.toContain('Шаг');
    expect(result.replyText).not.toContain('100%');
    expect(result.replyMarkup?.inline_keyboard?.[0]?.[0]?.text).toBe('Подключить новый объект');
    expect(opsTaskCalls).toHaveLength(0);
  });

  it('/reset clears conversational flow and shows MK-first question', async () => {
    seedCompletedObject(8802);

    const result = await processTelegramOwnerOnboarding({
      envelope: envelope('/reset'),
      chatId: 8802,
      senderIdentity: 'lead',
    });

    expect(result.replyText).toContain('Начнём заново');
    expect(result.replyText).toContain('менеджер каналов');
    expect(result.replyMarkup?.inline_keyboard?.[0]?.[0]?.text).toBe('Да, уже есть');
    const records = listOwnerObjectRecords(8802, 'telegram');
    expect(records).toHaveLength(2);
    expect(readOwnerObjectState(8802, 'telegram', 'OBJ-0001').address).toContain('Невский');
    expect(readOwnerObjectState(8802, 'telegram', 'OBJ-0002').mk_phase).toBe('ask_has_cm');
  });

  it('/start shows main menu from completed state without creating duplicate objects', async () => {
    seedCompletedObject(8803);

    await processTelegramOwnerOnboarding({
      envelope: envelope('/start'),
      chatId: 8803,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: envelope('/start'),
      chatId: 8803,
      senderIdentity: 'lead',
    });

    expect(listOwnerObjectRecords(8803, 'telegram')).toHaveLength(1);
  });

  it('starts MK-first on connect intent from completed session', async () => {
    seedCompletedObject(8804);

    const result = await processTelegramOwnerOnboarding({
      envelope: envelope('Хочу подключить ASI'),
      chatId: 8804,
      senderIdentity: 'lead',
    });

    expect(result.replyText).toContain('менеджер каналов');
    expect(result.replyText).not.toContain('Невский проспект');
    expect(result.state.mk_phase).toBe('ask_has_cm');
    expect(listOwnerObjectRecords(8804, 'telegram')).toHaveLength(2);
  });

  it('status button shows last completed object without OPS side effects', async () => {
    seedCompletedObject(8805);

    const result = await processTelegramOwnerOnboarding({
      envelope: menuCb(`${START_MENU_CALLBACK_PREFIX}status`),
      chatId: 8805,
      senderIdentity: 'lead',
    });

    expect(result.replyText).toContain('Апартаменты у Невского');
    expect(result.replyText).toContain('Готовность:');
    expect(opsTaskCalls).toHaveLength(0);
    expect(listOwnerObjectRecords(8805, 'telegram')).toHaveLength(1);
  });

  it('new object intent offers same-address choice when previous object has address', async () => {
    seedCompletedObject(8806);

    const result = await processTelegramOwnerOnboarding({
      envelope: envelope('Подключить новый объект'),
      chatId: 8806,
      senderIdentity: 'lead',
    });

    expect(result.replyText).toContain('тот же адрес');
    expect(result.replyText).toContain('Невский проспект');
    expect(readOwnerObjectState(8806, 'telegram', 'OBJ-0001').status).toBe('ready_for_channel_manager');
    expect(listOwnerObjectRecords(8806, 'telegram')).toHaveLength(2);
  });
});
