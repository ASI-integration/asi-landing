import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboundMessageEnvelope } from '../types';

const crmRows = new Map<string, Record<string, unknown>>();
const insertedRows: Array<Record<string, unknown>> = [];
const updatedRows: Array<{ id: string; patch: Record<string, unknown> }> = [];

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
        updatedRows.push({ id, patch });
        return { data: null, error: null };
      },
    })),
    insert: vi.fn((row: Record<string, unknown>) => {
      insertedRows.push(row);
      const id = `crm-${insertedRows.length}`;
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

import { __resetAutonomousSessionStoreForTests, loadAutonomousSession } from '../conversation-session-store';
import { resolveCommunicationIdentityRoute } from '../communication-identity-routing';
import { processTelegramOwnerOnboarding } from '../telegram-owner-onboarding';

function envelope(messageText: string, extra?: Partial<InboundMessageEnvelope>): InboundMessageEnvelope {
  return {
    channel: 'telegram',
    externalUserId: '7001',
    chatId: '7001',
    messageText,
    receivedAt: new Date(),
    update_id: 70_001,
    metadata: {
      telegram_chat_id: '7001',
      telegram_user_id: 7001,
      telegram_username: 'owner_v1',
      telegram_first_name: 'Анна',
      providerMessageId: `msg-${Math.random()}`,
      ...extra?.metadata,
    },
    ...extra,
  };
}

const unresolvedIdentity = {
  role: 'unknown' as const,
  entityType: 'unknown' as const,
  confidence: 0,
  status: 'unresolved' as const,
  reason: 'test',
};

describe('Telegram owner auto-onboarding v1', () => {
  beforeEach(() => {
    __resetAutonomousSessionStoreForTests();
    crmRows.clear();
    insertedRows.length = 0;
    updatedRows.length = 0;
  });

  it('asks unknown Telegram users to choose owner connection or guest support', async () => {
    const route = await resolveCommunicationIdentityRoute({
      envelope: envelope('Здравствуйте'),
      identity: unresolvedIdentity,
    });

    expect(route.route).toBe('unknown_clarify');
    expect(route.shouldRunGuestConcierge).toBe(false);
    expect(route.replyText).toContain('кто вы');
    expect(route.replyMarkup).toMatchObject({
      inline_keyboard: expect.arrayContaining([
        expect.arrayContaining([expect.objectContaining({ text: 'Я гость', callback_data: 'identity:guest' })]),
        expect.arrayContaining([expect.objectContaining({ text: 'Хочу подключить ASI', callback_data: 'identity:lead' })]),
      ]),
    });
  });

  it('keeps guest messages on the guest support route', async () => {
    const route = await resolveCommunicationIdentityRoute({
      envelope: envelope('не работает Wi-Fi', { metadata: { senderIdentity: 'guest' } }),
      identity: unresolvedIdentity,
    });

    expect(route.senderIdentity).toBe('guest');
    expect(route.route).toBe('guest_concierge');
    expect(route.shouldRunGuestConcierge).toBe(true);
  });

  it('routes owner and lead identities away from Guest Concierge', async () => {
    const owner = await resolveCommunicationIdentityRoute({
      envelope: envelope('Я владелец / управляющий объекта', { metadata: { senderIdentity: 'owner_manager' } }),
      identity: unresolvedIdentity,
    });
    const lead = await resolveCommunicationIdentityRoute({
      envelope: envelope('Хочу подключить ASI', { metadata: { senderIdentity: 'lead' } }),
      identity: unresolvedIdentity,
    });

    expect(owner.route).toBe('owner_manager');
    expect(owner.shouldRunGuestConcierge).toBe(false);
    expect(lead.route).toBe('lead');
    expect(lead.shouldRunGuestConcierge).toBe(false);
  });

  it('starts onboarding, creates a CRM lead card, and asks for the first missing field', async () => {
    const result = await processTelegramOwnerOnboarding({
      envelope: envelope('Хочу подключить ASI'),
      chatId: 7001,
      senderIdentity: 'lead',
    });

    expect(result.status).toBe('onboarding_started');
    expect(result.missing[0]).toBe('address');
    expect(result.replyText).toContain('Пришлите адрес объекта');
    expect(insertedRows.at(-1)).toMatchObject({
      contact: 'owner_v1',
      source: 'telegram',
      status: 'contact',
    });
    expect(loadAutonomousSession(7001)?.collected_data.owner_onboarding_status).toBe('onboarding_started');
  });

  it('saves onboarding data step by step and does not ask for saved fields again', async () => {
    await processTelegramOwnerOnboarding({ envelope: envelope('Хочу подключить ASI'), chatId: 7001, senderIdentity: 'lead' });
    const result = await processTelegramOwnerOnboarding({
      envelope: envelope('Адрес: Санкт-Петербург, Невский проспект 24'),
      chatId: 7001,
      senderIdentity: 'lead',
    });

    expect(result.status).toBe('missing_required_data');
    expect(result.missing).not.toContain('address');
    expect(result.replyText).toContain('Сохранила: адрес объекта');
    expect(result.replyText).toContain('название или тип объекта');
  });

  it('moves to ready_for_channel_manager and returns a Channel Manager button when minimum data is collected', async () => {
    await processTelegramOwnerOnboarding({ envelope: envelope('Хочу подключить ASI'), chatId: 7002, senderIdentity: 'lead' });
    await processTelegramOwnerOnboarding({ envelope: envelope('Адрес: Санкт-Петербург, Невский проспект 24'), chatId: 7002, senderIdentity: 'lead' });
    await processTelegramOwnerOnboarding({ envelope: envelope('Апартаменты у метро'), chatId: 7002, senderIdentity: 'lead' });
    await processTelegramOwnerOnboarding({ envelope: envelope('Правила: нельзя курить, тишина после 23:00'), chatId: 7002, senderIdentity: 'lead' });
    await processTelegramOwnerOnboarding({ envelope: envelope('Wi-Fi ASI Guest, пароль 12345678'), chatId: 7002, senderIdentity: 'lead' });
    await processTelegramOwnerOnboarding({ envelope: envelope('Заезд с 15:00, выезд до 11:00'), chatId: 7002, senderIdentity: 'lead' });
    await processTelegramOwnerOnboarding({
      envelope: envelope('[photo]', { metadata: { attachments: [{ type: 'photo', label: 'Фото объекта' }] } }),
      chatId: 7002,
      senderIdentity: 'lead',
    });
    const ready = await processTelegramOwnerOnboarding({
      envelope: envelope('Каналы: Авито, Суточно, Островок'),
      chatId: 7002,
      senderIdentity: 'lead',
    });

    expect(ready.status).toBe('ready_for_channel_manager');
    expect(ready.missing).toEqual([]);
    expect(ready.replyText).toContain('готов к следующему шагу');
    expect(ready.replyText).toContain('/dashboard/channel-connections');
    expect(ready.replyMarkup).toMatchObject({
      inline_keyboard: [[{ text: 'Открыть Менеджер каналов' }]],
    });
  });

  it('marks needs_operator when owner gets stuck outside the onboarding script', async () => {
    await processTelegramOwnerOnboarding({ envelope: envelope('Хочу подключить ASI'), chatId: 7003, senderIdentity: 'lead' });
    const result = await processTelegramOwnerOnboarding({
      envelope: envelope('я не понимаю, что дальше'),
      chatId: 7003,
      senderIdentity: 'lead',
    });

    expect(result.status).toBe('needs_operator');
    expect(result.replyText).toContain('нужна ручная помощь');
    expect(insertedRows.at(-1)?.communication_status ?? updatedRows.at(-1)?.patch.communication_status).toBe('needs_manual_reaction');
  });

  it('does not run owner onboarding for guests', async () => {
    const result = await processTelegramOwnerOnboarding({
      envelope: envelope('Я гость, не работает Wi-Fi'),
      chatId: 7004,
      senderIdentity: 'guest',
    });

    expect(result.handled).toBe(false);
    expect(insertedRows).toHaveLength(0);
    expect(loadAutonomousSession(7004)).toBeUndefined();
  });
});
