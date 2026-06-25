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
      insertedRows.push({ table, row });
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
import {
  allFixedChannelIds,
  allRuleIds,
  buildChannelsKeyboard,
  buildRulesKeyboard,
  buildTimeKeyboard,
  CHANNEL_OPTIONS,
  CUSTOM_CHANNEL_INPUT_PROMPT_RU,
  CUSTOM_TIME_INPUT_PROMPT_RU,
  customChannelIdFromLabel,
  parseCustomChannelsInput,
  resolveChannelDraftIds,
  parseCustomTimeInput,
  RULE_OPTIONS,
} from '../telegram-owner-onboarding-wizard';

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
    expect(result.replyText).toMatch(/фото|канал|Шаг/i);
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
    expect(insertedRows.find((item) => item.table === 'crm_contacts')?.row).toMatchObject({
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
    expect(result.state.readiness?.readiness_percent).toBeGreaterThan(0);
    expect(result.replyText).toMatch(/Готовность объекта/i);
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

  it('accepts photos_intent=later and asks for the next missing field', async () => {
    await processTelegramOwnerOnboarding({ envelope: envelope('Хочу подключить ASI'), chatId: 7010, senderIdentity: 'lead' });
    await processTelegramOwnerOnboarding({
      envelope: envelope('Адрес: Казань, Баумана 5'),
      chatId: 7010,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({ envelope: envelope('Апартаменты'), chatId: 7010, senderIdentity: 'lead' });
    await processTelegramOwnerOnboarding({
      envelope: envelope('Правила: без курения, тишина после 23:00'),
      chatId: 7010,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: envelope('Wi-Fi Guest / pass123'),
      chatId: 7010,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: envelope('Заезд с 15:00, выезд до 11:00'),
      chatId: 7010,
      senderIdentity: 'lead',
    });
    const photosLater = await processTelegramOwnerOnboarding({
      envelope: envelope('Фото пришлю позже'),
      chatId: 7010,
      senderIdentity: 'lead',
    });

    expect(photosLater.state.photos_intent).toBe('later');
    expect(photosLater.missing).not.toContain('photos');
    expect(photosLater.missing[0]).toBe('channels');
    expect(photosLater.replyText).toMatch(/канал|Готово/i);
  });

  it('does not run owner onboarding for guests', async () => {
    const result = await processTelegramOwnerOnboarding({
      envelope: envelope('Я гость, не работает Wi-Fi'),
      chatId: 7004,
      senderIdentity: 'guest',
    });

    expect(result.handled).toBe(false);
    expect(insertedRows.filter((item) => item.table === 'crm_contacts')).toHaveLength(0);
    expect(loadAutonomousSession(7004)).toBeUndefined();
  });
});

describe('Telegram owner onboarding wizard v2', () => {
  beforeEach(() => {
    __resetAutonomousSessionStoreForTests();
    crmRows.clear();
    insertedRows.length = 0;
    updatedRows.length = 0;
    __setOwnerOnboardingSmartParserLlmOverrideForTests(null);
  });

  function wizardEnvelope(callbackData: string): InboundMessageEnvelope {
    return envelope('', {
      metadata: {
        telegram_onboarding_wizard_callback: callbackData,
      },
    });
  }

  async function runFullWizardScenario(chatId: number): Promise<void> {
    await processTelegramOwnerOnboarding({
      envelope: envelope('Хочу подключить квартиру'),
      chatId,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: envelope('Санкт-Петербург, Лиговский пр., 108'),
      chatId,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:type:Квартира'),
      chatId,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:chk_in:14:00'),
      chatId,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:chk_out:12:00'),
      chatId,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:ch_t:sutochno'),
      chatId,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:ch_t:avito'),
      chatId,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:ch_done'),
      chatId,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:rl_t:no_smoke'),
      chatId,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:rl_t:no_parties'),
      chatId,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:rl_done'),
      chatId,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:wifi_later'),
      chatId,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:photo_later'),
      chatId,
      senderIdentity: 'lead',
    });
  }

  it('walks through wizard v2 and reaches ready_for_channel_manager', async () => {
    await runFullWizardScenario(7201);
    const state = loadAutonomousSession(7201)?.collected_data;
    expect(state?.owner_onboarding_status).toBe('ready_for_channel_manager');
    expect(state?.owner_onboarding_object_type).toBe('Квартира');
    expect(state?.owner_onboarding_checkin_time).toBe('14:00');
    expect(state?.owner_onboarding_checkout_time).toBe('12:00');
    expect(JSON.parse(state?.owner_onboarding_channels_list ?? '[]')).toEqual(
      expect.arrayContaining(['Суточно', 'Авито']),
    );
    expect(JSON.parse(state?.owner_onboarding_rules ?? '[]')).toEqual(
      expect.arrayContaining(['Не курить', 'Без вечеринок']),
    );
    expect(state?.owner_onboarding_wifi_skipped).toBe('1');
    expect(state?.owner_onboarding_photos_intent).toBe('later');
  });

  it('shows step progress and growing readiness during wizard', async () => {
    await processTelegramOwnerOnboarding({
      envelope: envelope('Хочу подключить квартиру'),
      chatId: 7202,
      senderIdentity: 'lead',
    });
    const address = await processTelegramOwnerOnboarding({
      envelope: envelope('Санкт-Петербург, Лиговский пр., 108'),
      chatId: 7202,
      senderIdentity: 'lead',
    });
    expect(address.replyText).toMatch(/Шаг 2 из 8/);
    expect(address.state.readiness?.readiness_percent).toBeGreaterThanOrEqual(10);

    const type = await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:type:Квартира'),
      chatId: 7202,
      senderIdentity: 'lead',
    });
    expect(type.replyText).toMatch(/Тип объекта сохранён/);
    expect(type.replyText).toMatch(/Готовность объекта:/);
    expect(type.replyMarkup?.inline_keyboard?.length).toBeGreaterThan(0);
  });

  it('stores structured CRM fields separately in notes', async () => {
    await runFullWizardScenario(7203);
    const notes = String(
      [
        ...updatedRows.map((item) => (item.patch as { notes?: unknown })?.notes),
        ...insertedRows.map((item) => (item.row as { notes?: unknown })?.notes),
      ]
        .filter(Boolean)
        .pop() ?? '',
    );
    expect(notes).toContain('Тип объекта: Квартира');
    expect(notes).toContain('Заезд: 14:00');
    expect(notes).toContain('Выезд: 12:00');
    expect(notes).toContain('Каналы:');
    expect(notes).toContain('Правила:');
    expect(notes).toContain('Wi-Fi: добавлю позже');
    expect(notes).toMatch(/Фото: 0/);
  });

  it('still accepts legacy free-text bulk onboarding as fallback', async () => {
    await processTelegramOwnerOnboarding({
      envelope: envelope('Хочу подключить ASI'),
      chatId: 7204,
      senderIdentity: 'lead',
    });
    const legacy = await processTelegramOwnerOnboarding({
      envelope: envelope(
        'Адрес: Казань, Баумана 5. Апартаменты. Правила: не курить. Wi-Fi Guest / pass123. Заезд 15:00, выезд 11:00. Каналы: Авито, Суточно. Фото позже.',
      ),
      chatId: 7204,
      senderIdentity: 'lead',
    });

    expect(legacy.status).not.toBe('needs_operator');
    expect(legacy.state.address).toMatch(/Баумана/i);
    expect(legacy.state.object_type ?? legacy.state.property_name).toMatch(/апартамент/i);
    expect(legacy.state.checkin_time ?? legacy.state.checkin_checkout).toMatch(/15:00/);
  });

  async function walkToCheckoutStep(chatId: number) {
    await processTelegramOwnerOnboarding({
      envelope: envelope('Хочу подключить квартиру'),
      chatId,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: envelope('Санкт-Петербург, Лиговский пр., 108'),
      chatId,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:type:Квартира'),
      chatId,
      senderIdentity: 'lead',
    });
    return processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:chk_in:14:00'),
      chatId,
      senderIdentity: 'lead',
    });
  }

  it('shows multi-select buttons without empty checkbox for unselected items', () => {
    const channels = buildChannelsKeyboard([]).inline_keyboard.flat().map((button) => button.text);
    expect(channels.some((label) => label.includes('☐'))).toBe(false);
    expect(channels).toContain('Суточно');

    const rules = buildRulesKeyboard([]).inline_keyboard.flat().map((button) => button.text);
    expect(rules.some((label) => label.includes('☐'))).toBe(false);
    expect(rules).toContain('Не курить');
  });

  it('shows selected multi-select items with checkmark prefix', () => {
    const channelLabel = buildChannelsKeyboard(['sutochno']).inline_keyboard
      .flat()
      .find((button) => String(button.callback_data ?? '').includes('sutochno'))?.text;
    expect(channelLabel).toBe('✅ Суточно');

    const ruleLabel = buildRulesKeyboard(['no_smoke']).inline_keyboard
      .flat()
      .find((button) => String(button.callback_data ?? '').includes('no_smoke'))?.text;
    expect(ruleLabel).toBe('✅ Не курить');
  });

  it('offers checkout quick buttons including 11:00', () => {
    const labels = buildTimeKeyboard('checkout_time').inline_keyboard.flat().map((button) => button.text);
    expect(labels).toEqual(expect.arrayContaining(['10:00', '11:00', '12:00', '13:00', 'Свой вариант']));
  });

  it('keeps checkin quick buttons at 12:00 through 15:00', () => {
    const labels = buildTimeKeyboard('checkin_time').inline_keyboard.flat().map((button) => button.text);
    expect(labels).toEqual(expect.arrayContaining(['12:00', '13:00', '14:00', '15:00', 'Свой вариант']));
    expect(labels).not.toContain('11:00');
  });

  it.each([
    ['11', '11:00'],
    ['11:00', '11:00'],
    ['11 утра', '11:00'],
    ['в 11', '11:00'],
    ['до 11', '11:00'],
  ])('parseCustomTimeInput parses %s as %s', (input, expected) => {
    expect(parseCustomTimeInput(input)).toBe(expected);
  });

  it('saves checkout 11:00 from quick button and grows readiness', async () => {
    const checkinDone = await walkToCheckoutStep(7210);
    const readinessBefore = checkinDone.state.readiness?.readiness_percent ?? 0;

    const checkout = await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:chk_out:11:00'),
      chatId: 7210,
      senderIdentity: 'lead',
    });

    expect(checkout.state.checkout_time).toBe('11:00');
    expect(checkout.replyText).toMatch(/Время выезда сохранено/);
    expect(checkout.state.readiness?.readiness_percent ?? 0).toBeGreaterThan(readinessBefore);
  });

  it('accepts custom checkout time "11 утра" without repeating time keyboard', async () => {
    await walkToCheckoutStep(7211);
    const customPrompt = await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:chk_out:custom'),
      chatId: 7211,
      senderIdentity: 'lead',
    });
    expect(customPrompt.replyText).toContain(CUSTOM_TIME_INPUT_PROMPT_RU);
    expect(customPrompt.replyMarkup).toBeUndefined();

    const saved = await processTelegramOwnerOnboarding({
      envelope: envelope('11 утра'),
      chatId: 7211,
      senderIdentity: 'lead',
    });
    expect(saved.state.checkout_time).toBe('11:00');
    expect(saved.replyText).toMatch(/Время выезда сохранено/);
  });

  it('accepts custom checkout time "до 11"', async () => {
    await walkToCheckoutStep(7212);
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:chk_out:custom'),
      chatId: 7212,
      senderIdentity: 'lead',
    });
    const saved = await processTelegramOwnerOnboarding({
      envelope: envelope('до 11'),
      chatId: 7212,
      senderIdentity: 'lead',
    });
    expect(saved.state.checkout_time).toBe('11:00');
  });

  async function walkToChannelsStep(chatId: number) {
    await walkToCheckoutStep(chatId);
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:chk_out:12:00'),
      chatId,
      senderIdentity: 'lead',
    });
  }

  it('includes extended booking channel options and quick actions', () => {
    const labels = buildChannelsKeyboard([]).inline_keyboard.flat().map((button) => button.text);
    expect(labels).toEqual(
      expect.arrayContaining([
        'Собственный сайт',
        'Соцсети',
        'VK',
        'Telegram',
        'Прямые брони',
        '✅ Выбрать все',
        '↩️ Снять всё',
        'Свой вариант',
        '🚀 Готово, запустить подготовку',
      ]),
    );
    const actionLabels = labels.slice(-4);
    expect(actionLabels).toEqual([
      '✅ Выбрать все',
      '↩️ Снять всё',
      'Свой вариант',
      '🚀 Готово, запустить подготовку',
    ]);
  });

  it.each([
    ['own_site', 'Собственный сайт', 7311],
    ['social', 'Соцсети', 7312],
    ['vk', 'VK', 7313],
    ['telegram', 'Telegram', 7314],
    ['direct_bookings', 'Прямые брони', 7315],
  ])('saves fixed channel %s via multi-select', async (channelId, label, chatId) => {
    await walkToChannelsStep(chatId);
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope(`obv2:ch_t:${channelId}`),
      chatId,
      senderIdentity: 'lead',
    });
    const done = await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:ch_done'),
      chatId,
      senderIdentity: 'lead',
    });
    expect(done.state.channels_list).toEqual(expect.arrayContaining([label]));
    expect(done.missing[0]).toBe('rules');
  });

  it('prompts for custom channel input when "Свой вариант" is pressed', async () => {
    await walkToChannelsStep(7230);
    const prompt = await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:ch_custom'),
      chatId: 7230,
      senderIdentity: 'lead',
    });
    expect(prompt.replyText).toContain(CUSTOM_CHANNEL_INPUT_PROMPT_RU);
    expect(prompt.state.awaiting_custom).toBe('channels');
    expect(prompt.editInPlace).toBe(true);
    expect(prompt.editInPlaceMode).toBe('text');
  });

  it('saves single custom channel TravelLine and shows it selected', async () => {
    await walkToChannelsStep(7231);
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:ch_custom'),
      chatId: 7231,
      senderIdentity: 'lead',
    });
    const saved = await processTelegramOwnerOnboarding({
      envelope: envelope('TravelLine'),
      chatId: 7231,
      senderIdentity: 'lead',
    });
    expect(saved.state.channels_draft).toEqual(expect.arrayContaining([customChannelIdFromLabel('TravelLine')]));
    const customButton = saved.replyMarkup?.inline_keyboard
      ?.flat()
      .find((button) => button.text === '✅ TravelLine');
    expect(customButton).toBeTruthy();
    expect(saved.missing[0]).toBe('channels');
  });

  it('saves multiple custom channels from comma-separated input', async () => {
    await walkToChannelsStep(7232);
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:ch_custom'),
      chatId: 7232,
      senderIdentity: 'lead',
    });
    const saved = await processTelegramOwnerOnboarding({
      envelope: envelope('TravelLine, МирКвартир'),
      chatId: 7232,
      senderIdentity: 'lead',
    });
    expect(saved.state.channels_draft).toEqual(
      expect.arrayContaining([
        customChannelIdFromLabel('TravelLine'),
        customChannelIdFromLabel('МирКвартир'),
      ]),
    );
    const labels = saved.replyMarkup?.inline_keyboard?.flat().map((button) => button.text) ?? [];
    expect(labels).toEqual(expect.arrayContaining(['✅ TravelLine', '✅ МирКвартир']));
  });

  it('maps "прямые брони" from custom input to fixed channel option', () => {
    expect(resolveChannelDraftIds(parseCustomChannelsInput('TravelLine, МирКвартир, прямые брони'))).toEqual(
      expect.arrayContaining(['direct_bookings', customChannelIdFromLabel('TravelLine'), customChannelIdFromLabel('МирКвартир')]),
    );
  });

  it('counts custom channels toward readiness after "Готово"', async () => {
    await walkToChannelsStep(7233);
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:ch_custom'),
      chatId: 7233,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: envelope('TravelLine'),
      chatId: 7233,
      senderIdentity: 'lead',
    });
    const done = await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:ch_done'),
      chatId: 7233,
      senderIdentity: 'lead',
    });
    expect(done.state.channels_list).toEqual(expect.arrayContaining(['TravelLine']));
    expect(done.missing[0]).toBe('rules');
    expect(done.state.readiness?.missing_required_fields ?? []).not.toContain('channels');
  });

  it('writes custom channels to CRM notes together with fixed channels', async () => {
    await walkToChannelsStep(7234);
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:ch_t:sutochno'),
      chatId: 7234,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:ch_custom'),
      chatId: 7234,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: envelope('TravelLine'),
      chatId: 7234,
      senderIdentity: 'lead',
    });
    const done = await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:ch_done'),
      chatId: 7234,
      senderIdentity: 'lead',
    });
    const crmNotes = [
      ...insertedRows
        .filter((item) => item.table === 'crm_contacts')
        .map((item) => String((item.row as { notes?: string }).notes ?? '')),
      ...updatedRows.map((item) => String(item.patch.notes ?? '')),
    ];
    expect(crmNotes.some((notes) => /Каналы:[\s\S]*Суточно[\s\S]*TravelLine/.test(notes))).toBe(true);
    expect(done.state.channels_list).toEqual(expect.arrayContaining(['Суточно', 'TravelLine']));
  });

  it('emits activity feed event for saved custom channel', async () => {
    await walkToChannelsStep(7235);
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:ch_custom'),
      chatId: 7235,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: envelope('TravelLine'),
      chatId: 7235,
      senderIdentity: 'lead',
    });
    const channelEvent = insertedRows.find(
      (item) =>
        item.table === 'crm_events' &&
        (item.row as { event_type?: string }).event_type === 'onboarding_channel_saved',
    );
    expect((channelEvent?.row as { message_text?: string }).message_text).toBe(
      'ASI сохранила канал бронирования: TravelLine',
    );
  });

  it('marks channel toggle callbacks for in-place edit without advancing step', async () => {
    await walkToCheckoutStep(7213);
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:chk_out:12:00'),
      chatId: 7213,
      senderIdentity: 'lead',
    });

    const toggle = await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:ch_t:sutochno'),
      chatId: 7213,
      senderIdentity: 'lead',
    });

    expect(toggle.editInPlace).toBe(true);
    expect(toggle.editInPlaceMode).toBe('markup');
    expect(toggle.missing[0]).toBe('channels');
    expect(toggle.state.channels_draft).toEqual(['sutochno']);
    expect(toggle.replyMarkup?.inline_keyboard?.flat().find((button) => String(button.callback_data).includes('sutochno'))?.text).toBe(
      '✅ Суточно',
    );
  });

  it('keeps multiple selected channels in one wizard reply markup', async () => {
    await walkToCheckoutStep(7214);
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:chk_out:12:00'),
      chatId: 7214,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:ch_t:sutochno'),
      chatId: 7214,
      senderIdentity: 'lead',
    });
    const both = await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:ch_t:avito'),
      chatId: 7214,
      senderIdentity: 'lead',
    });

    const labels = both.replyMarkup?.inline_keyboard?.flat().map((button) => button.text) ?? [];
    expect(labels).toEqual(
      expect.arrayContaining(['✅ Суточно', '✅ Авито', '🚀 Готово, запустить подготовку']),
    );
    expect(both.missing[0]).toBe('channels');
    expect(both.state.channels_list ?? []).toEqual([]);
  });

  it('advances from channels to rules only after "Готово"', async () => {
    await walkToCheckoutStep(7215);
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:chk_out:12:00'),
      chatId: 7215,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:ch_t:sutochno'),
      chatId: 7215,
      senderIdentity: 'lead',
    });
    const done = await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:ch_done'),
      chatId: 7215,
      senderIdentity: 'lead',
    });

    expect(done.editInPlace).toBeUndefined();
    expect(done.missing[0]).toBe('rules');
    expect(done.state.channels_list).toEqual(expect.arrayContaining(['Суточно']));
    expect(done.replyText).toMatch(/правил/i);
  });

  it('marks rule toggle callbacks for in-place edit and advances only on "Готово"', async () => {
    await walkToCheckoutStep(7216);
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:chk_out:12:00'),
      chatId: 7216,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:ch_t:sutochno'),
      chatId: 7216,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:ch_done'),
      chatId: 7216,
      senderIdentity: 'lead',
    });

    const toggle = await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:rl_t:no_smoke'),
      chatId: 7216,
      senderIdentity: 'lead',
    });
    expect(toggle.editInPlace).toBe(true);
    expect(toggle.editInPlaceMode).toBe('markup');
    expect(toggle.missing[0]).toBe('rules');

    const done = await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:rl_done'),
      chatId: 7216,
      senderIdentity: 'lead',
    });
    expect(done.editInPlace).toBeUndefined();
    expect(done.missing[0]).toBe('wifi');
    expect(done.state.rules).toEqual(expect.arrayContaining(['Не курить']));
  });

  it('selects all fixed channels on "Выбрать всё" with checkmarks', async () => {
    await walkToChannelsStep(7320);
    const selected = await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:ch_all'),
      chatId: 7320,
      senderIdentity: 'lead',
    });

    expect(selected.editInPlace).toBe(true);
    expect(selected.editInPlaceMode).toBe('markup');
    expect(selected.state.channels_draft).toEqual(allFixedChannelIds());
    const labels = selected.replyMarkup?.inline_keyboard?.flat().map((button) => button.text) ?? [];
    for (const item of CHANNEL_OPTIONS) {
      expect(labels).toContain(`✅ ${item.label}`);
    }
  });

  it('clears all channels on "Снять всё"', async () => {
    await walkToChannelsStep(7321);
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:ch_all'),
      chatId: 7321,
      senderIdentity: 'lead',
    });
    const cleared = await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:ch_none'),
      chatId: 7321,
      senderIdentity: 'lead',
    });

    expect(cleared.state.channels_draft).toEqual([]);
    const labels = cleared.replyMarkup?.inline_keyboard?.flat().map((button) => button.text) ?? [];
    expect(labels.some((label) => label.startsWith('✅'))).toBe(false);
  });

  it('keeps custom channels when "Выбрать всё" is pressed', async () => {
    await walkToChannelsStep(7322);
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:ch_custom'),
      chatId: 7322,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: envelope('TravelLine'),
      chatId: 7322,
      senderIdentity: 'lead',
    });
    const selected = await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:ch_all'),
      chatId: 7322,
      senderIdentity: 'lead',
    });

    const travelLineId = customChannelIdFromLabel('TravelLine');
    expect(selected.state.channels_draft).toEqual(expect.arrayContaining([travelLineId, ...allFixedChannelIds()]));
    const labels = selected.replyMarkup?.inline_keyboard?.flat().map((button) => button.text) ?? [];
    expect(labels).toContain('✅ TravelLine');
  });

  it('removes custom channels on "Снять всё"', async () => {
    await walkToChannelsStep(7323);
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:ch_custom'),
      chatId: 7323,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: envelope('TravelLine'),
      chatId: 7323,
      senderIdentity: 'lead',
    });
    const cleared = await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:ch_none'),
      chatId: 7323,
      senderIdentity: 'lead',
    });

    expect(cleared.state.channels_draft).toEqual([]);
    const labels = cleared.replyMarkup?.inline_keyboard?.flat().map((button) => button.text) ?? [];
    expect(labels).not.toContain('✅ TravelLine');
  });

  it('advances to rules after "Готово" following "Выбрать всё"', async () => {
    await walkToChannelsStep(7324);
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:ch_all'),
      chatId: 7324,
      senderIdentity: 'lead',
    });
    const done = await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:ch_done'),
      chatId: 7324,
      senderIdentity: 'lead',
    });

    expect(done.missing[0]).toBe('rules');
    expect(done.state.channels_list?.length).toBe(CHANNEL_OPTIONS.length);
    expect(done.replyText).toMatch(/правил/i);
  });

  it('selects all rules on "Выбрать всё"', async () => {
    await walkToChannelsStep(7325);
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:ch_all'),
      chatId: 7325,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:ch_done'),
      chatId: 7325,
      senderIdentity: 'lead',
    });

    const selected = await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:rl_all'),
      chatId: 7325,
      senderIdentity: 'lead',
    });

    expect(selected.state.rules_draft).toEqual(allRuleIds());
    const labels = selected.replyMarkup?.inline_keyboard?.flat().map((button) => button.text) ?? [];
    for (const item of RULE_OPTIONS) {
      expect(labels).toContain(`✅ ${item.label}`);
    }
    const actionLabels = labels.slice(-3);
    expect(actionLabels).toEqual(['Выбрать всё', 'Снять всё', 'Готово']);
  });

  it('clears all rules on "Снять всё"', async () => {
    await walkToChannelsStep(7326);
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:ch_all'),
      chatId: 7326,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:ch_done'),
      chatId: 7326,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:rl_all'),
      chatId: 7326,
      senderIdentity: 'lead',
    });
    const cleared = await processTelegramOwnerOnboarding({
      envelope: wizardEnvelope('obv2:rl_none'),
      chatId: 7326,
      senderIdentity: 'lead',
    });

    expect(cleared.state.rules_draft).toEqual([]);
    const labels = cleared.replyMarkup?.inline_keyboard?.flat().map((button) => button.text) ?? [];
    expect(labels.some((label) => label.startsWith('✅'))).toBe(false);
  });
});

describe('Telegram owner session router v1', () => {
  beforeEach(() => {
    __resetAutonomousSessionStoreForTests();
    crmRows.clear();
    insertedRows.length = 0;
    updatedRows.length = 0;
    __setOwnerOnboardingSmartParserLlmOverrideForTests(null);
  });

  function routerEnvelope(callbackData: string): InboundMessageEnvelope {
    return envelope('', {
      metadata: {
        telegram_session_router_callback: callbackData,
      },
    });
  }

  it('prompts to continue, create new, or list objects when a second connection intent arrives', async () => {
    await processTelegramOwnerOnboarding({
      envelope: envelope('Хочу подключить квартиру'),
      chatId: 7301,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: envelope('Большой проспект П.С., 106'),
      chatId: 7301,
      senderIdentity: 'lead',
    });

    const prompt = await processTelegramOwnerOnboarding({
      envelope: envelope('Хочу подключить квартиру'),
      chatId: 7301,
      senderIdentity: 'lead',
    });

    expect(prompt.replyText).toContain('У вас уже есть объект в работе');
    expect(prompt.replyText).toContain('Большой проспект П.С., 106');
    expect(prompt.replyMarkup?.inline_keyboard?.[0]?.[0]?.text).toBe('Продолжить');
    expect(prompt.replyMarkup?.inline_keyboard?.[1]?.[0]?.text).toBe('Создать новый');
  });

  it('keeps object data isolated across create, switch, and continue', async () => {
    await processTelegramOwnerOnboarding({
      envelope: envelope('Хочу подключить квартиру'),
      chatId: 7302,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: envelope('Большой проспект П.С., 106'),
      chatId: 7302,
      senderIdentity: 'lead',
    });

    const createNew = await processTelegramOwnerOnboarding({
      envelope: routerEnvelope('obsr:new'),
      chatId: 7302,
      senderIdentity: 'lead',
    });
    expect(createNew.replyText).toContain('OBJ-0002');

    await processTelegramOwnerOnboarding({
      envelope: envelope('Лиговский пр., 108'),
      chatId: 7302,
      senderIdentity: 'lead',
    });

    const switched = await processTelegramOwnerOnboarding({
      envelope: routerEnvelope('obsr:switch:OBJ-0001'),
      chatId: 7302,
      senderIdentity: 'lead',
    });
    expect(switched.replyText).toContain('Большой проспект П.С., 106');
    expect(switched.state.address).toContain('Большой проспект П.С., 106');

    const active = loadAutonomousSession(7302)?.collected_data;
    expect(active?.owner_active_object_id).toBe('OBJ-0001');
    const obj2 = JSON.parse(String(active?.['owner_obj_state_OBJ-0002'] ?? '{}'));
    expect(obj2.address).toContain('Лиговский пр., 108');
  });

  it('stores multiple objects in CRM notes with active session flag', async () => {
    await processTelegramOwnerOnboarding({
      envelope: envelope('Хочу подключить квартиру'),
      chatId: 7303,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: envelope('Большой проспект П.С., 106'),
      chatId: 7303,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: routerEnvelope('obsr:new'),
      chatId: 7303,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: envelope('Лиговский пр., 108'),
      chatId: 7303,
      senderIdentity: 'lead',
    });

    const notes = String(
      [
        ...updatedRows.map((item) => (item.patch as { notes?: unknown })?.notes),
        ...insertedRows.map((item) => (item.row as { notes?: unknown })?.notes),
      ]
        .filter(Boolean)
        .pop() ?? '',
    );
    expect(notes).toContain('Объекты владельца');
    expect(notes).toContain('OBJ-0001');
    expect(notes).toContain('OBJ-0002');
    expect(notes).toContain('активная сессия: да');
  });
});
