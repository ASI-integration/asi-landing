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
import {
  __setOwnerOnboardingSmartParserLlmOverrideForTests,
  extractFactsDeterministic,
  type SmartParseDecision,
  type SmartParseExtracted,
} from '../owner-onboarding-smart-parser';
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

function llmDecision(
  partial: Omit<Partial<SmartParseDecision>, 'extracted' | 'source'> & { extracted?: Partial<SmartParseExtracted> },
): SmartParseDecision {
  return {
    extracted: {
      address: null,
      city: null,
      property_type: null,
      property_name: null,
      rules: null,
      wifi: null,
      check_in: null,
      check_out: null,
      photos_intent: null,
      channels: [],
      ...(partial.extracted ?? {}),
    },
    confidence: partial.confidence ?? 'high',
    needs_clarification: partial.needs_clarification ?? false,
    clarification_question: partial.clarification_question ?? null,
    needs_operator: partial.needs_operator ?? false,
    operator_reason: partial.operator_reason ?? null,
    next_missing_field: partial.next_missing_field ?? null,
    source: 'llm',
  };
}

async function startOnboarding(chatId: number): Promise<void> {
  await processTelegramOwnerOnboarding({
    envelope: envelope('Хочу подключить квартиру'),
    chatId,
    senderIdentity: 'lead',
  });
}

describe('Owner onboarding smart parser', () => {
  beforeEach(() => {
    __resetAutonomousSessionStoreForTests();
    crmRows.clear();
    insertedRows.length = 0;
    updatedRows.length = 0;
    __setOwnerOnboardingSmartParserLlmOverrideForTests(null);
    delete process.env.LLM_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  it('saves "Лиговский 108" as address without operator escalation', async () => {
    await startOnboarding(7101);
    const result = await processTelegramOwnerOnboarding({
      envelope: envelope('Лиговский 108'),
      chatId: 7101,
      senderIdentity: 'lead',
    });

    expect(result.status).not.toBe('needs_operator');
    expect(result.state.address).toContain('Лиговский 108');
    expect(result.replyText).toMatch(/адрес/i);
  });

  it('parses "Питер, Лиговский 108" into city and address', async () => {
    await startOnboarding(7102);
    const result = await processTelegramOwnerOnboarding({
      envelope: envelope('Питер, Лиговский 108'),
      chatId: 7102,
      senderIdentity: 'lead',
    });

    expect(result.status).not.toBe('needs_operator');
    expect(result.state.city).toBe('Санкт-Петербург');
    expect(result.state.address).toMatch(/Лиговский 108/i);
  });

  it('asks to clarify address for "Ебург, квартира у вокзала" without operator', async () => {
    __setOwnerOnboardingSmartParserLlmOverrideForTests(async () =>
      llmDecision({
        extracted: {
          city: 'Екатеринбург',
          property_type: 'квартира',
          address: 'квартира у вокзала',
        },
        confidence: 'medium',
        needs_clarification: true,
        clarification_question: 'Не уверена, что правильно поняла адрес. Напишите, пожалуйста, город и улицу с номером дома.',
      }),
    );

    await startOnboarding(7103);
    const result = await processTelegramOwnerOnboarding({
      envelope: envelope('Ебург, квартира у вокзала'),
      chatId: 7103,
      senderIdentity: 'lead',
    });

    expect(result.status).not.toBe('needs_operator');
    expect(result.state.city).toBe('Екатеринбург');
    expect(result.replyText).toContain('улицу с номером дома');
  });

  it('saves check-in and check-out from natural language', async () => {
    await startOnboarding(7104);
    await processTelegramOwnerOnboarding({
      envelope: envelope('Питер, Лиговский 108'),
      chatId: 7104,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: envelope('Апартаменты'),
      chatId: 7104,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: envelope('Правила: не курить'),
      chatId: 7104,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: envelope('Wi-Fi ASI, пароль 12345678'),
      chatId: 7104,
      senderIdentity: 'lead',
    });

    const result = await processTelegramOwnerOnboarding({
      envelope: envelope('заезд после 14, выезд до 12'),
      chatId: 7104,
      senderIdentity: 'lead',
    });

    expect(result.status).not.toBe('needs_operator');
    expect(result.state.checkin_checkout).toMatch(/14:00/);
    expect(result.state.checkin_checkout).toMatch(/12:00/);
  });

  it('accepts "фото пришлю позже" without operator escalation', async () => {
    await startOnboarding(7105);
    const result = await processTelegramOwnerOnboarding({
      envelope: envelope('фото пришлю позже'),
      chatId: 7105,
      senderIdentity: 'lead',
    });

    expect(result.status).not.toBe('needs_operator');
    expect(result.state.photos_intent).toBe('later');
    expect(result.missing).not.toContain('photos');
    expect(result.replyText).toMatch(/фото можно добавить позже/i);
  });

  it('escalates to operator only after two unclear replies', async () => {
    __setOwnerOnboardingSmartParserLlmOverrideForTests(async () =>
      llmDecision({
        confidence: 'low',
        needs_clarification: true,
        clarification_question: 'Не уверена, что правильно поняла. Напишите, пожалуйста, адрес объекта.',
      }),
    );

    await startOnboarding(7106);
    await processTelegramOwnerOnboarding({
      envelope: envelope('Лиговский 108'),
      chatId: 7106,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: envelope('asdf qwerty ???'),
      chatId: 7106,
      senderIdentity: 'lead',
    });
    const second = await processTelegramOwnerOnboarding({
      envelope: envelope('ещё раз asdf ???'),
      chatId: 7106,
      senderIdentity: 'lead',
    });

    expect(second.status).toBe('needs_operator');
    expect(second.replyText).toContain('оператор');
  });

  it('escalates immediately when user asks for a human', async () => {
    await startOnboarding(7107);
    const result = await processTelegramOwnerOnboarding({
      envelope: envelope('позовите человека'),
      chatId: 7107,
      senderIdentity: 'lead',
    });

    expect(result.status).toBe('needs_operator');
    expect(result.replyText).toContain('оператор');
  });

  it('falls back to deterministic parsing when GPT-mini is unavailable', async () => {
    await startOnboarding(7108);
    const result = await processTelegramOwnerOnboarding({
      envelope: envelope('Лиговский 108'),
      chatId: 7108,
      senderIdentity: 'lead',
    });

    expect(result.status).not.toBe('needs_operator');
    expect(result.state.address).toContain('Лиговский 108');
  });

  it('does not start guest flow during active owner onboarding', async () => {
    await startOnboarding(7109);

    const route = await resolveCommunicationIdentityRoute({
      envelope: envelope('Лиговский 108'),
      identity: unresolvedIdentity,
    });

    expect(route.shouldRunGuestConcierge).toBe(false);
    expect(route.route).not.toBe('guest_concierge');
  });

  it('deterministic parser keeps wifi deferred without escalation', () => {
    const facts = extractFactsDeterministic('вайфай потом', ['wifi'], false);
    expect(facts.wifi).toBeUndefined();
  });
});

describe('Telegram owner auto-onboarding v1', () => {
  beforeEach(() => {
    __resetAutonomousSessionStoreForTests();
    crmRows.clear();
    insertedRows.length = 0;
    updatedRows.length = 0;
    __setOwnerOnboardingSmartParserLlmOverrideForTests(null);
  });

  it('asks unknown Telegram users to choose owner connection or guest support', async () => {
    const route = await resolveCommunicationIdentityRoute({
      envelope: envelope('Здравствуйте'),
      identity: unresolvedIdentity,
    });

    expect(route.route).toBe('unknown_clarify');
    expect(route.shouldRunGuestConcierge).toBe(false);
    expect(route.replyText).toContain('Чем могу помочь');
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
    expect(result.replyText).toContain('Поняла. Помогу подключить объект к ASI');
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
    expect(result.replyText).toMatch(/адрес/i);
  });

  it('moves to ready_for_channel_manager when minimum data is collected', async () => {
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
    expect(ready.replyMarkup).toMatchObject({
      inline_keyboard: [[{ text: 'Открыть Менеджер каналов' }]],
    });
  });

  it('marks needs_operator when user explicitly asks for help', async () => {
    await processTelegramOwnerOnboarding({ envelope: envelope('Хочу подключить ASI'), chatId: 7003, senderIdentity: 'lead' });
    const result = await processTelegramOwnerOnboarding({
      envelope: envelope('я не понимаю, что делать'),
      chatId: 7003,
      senderIdentity: 'lead',
    });

    expect(result.status).toBe('needs_operator');
    expect(result.replyText).toContain('оператор');
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
