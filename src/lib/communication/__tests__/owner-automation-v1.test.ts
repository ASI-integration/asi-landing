import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboundMessageEnvelope } from '../types';

const crmRows = new Map<string, Record<string, unknown>>();
const insertedRows: Array<Record<string, unknown>> = [];
const opsTaskCalls: Array<Record<string, unknown>> = [];
let pilotChainCalls = 0;

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
        for (const [key, value] of crmRows.entries()) {
          if ((value as { id?: string }).id === id) {
            crmRows.set(key, { ...(value as Record<string, unknown>), ...patch });
          }
        }
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
  runPilotChainForContact: vi.fn(async () => {
    pilotChainCalls += 1;
    return { contactId: 'crm-1', objectId: 'OBJ-0001', steps: [], contact: null, opsTaskId: null };
  }),
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

import { __resetAutonomousSessionStoreForTests, loadAutonomousSession } from '../conversation-session-store';
import { resolveCommunicationIdentityRoute } from '../communication-identity-routing';
import { processTelegramOwnerOnboarding } from '../telegram-owner-onboarding';
import {
  buildChannelsKeyboard,
  buildRulesKeyboard,
  customChannelIdFromLabel,
  validateOwnerContactInput,
} from '../telegram-owner-onboarding-wizard';

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
      telegram_username: 'owner_auto_v1',
      telegram_first_name: 'Ирина',
      providerMessageId: `msg-${Math.random()}`,
      ...extraMetadata,
    },
    ...restExtra,
  };
}

function mkCb(data: string): InboundMessageEnvelope {
  return envelope('', { metadata: { telegram_mk_onboarding_callback: data } });
}

function wizardCb(data: string): InboundMessageEnvelope {
  return envelope('', { metadata: { telegram_onboarding_wizard_callback: data } });
}

async function walkCoreSteps(chatId: number): Promise<void> {
  await processTelegramOwnerOnboarding({
    envelope: envelope('Хочу подключить ASI'),
    chatId,
    senderIdentity: 'lead',
  });
  await processTelegramOwnerOnboarding({
    envelope: mkCb('obmk:has:no'),
    chatId,
    senderIdentity: 'lead',
  });
  await processTelegramOwnerOnboarding({
    envelope: envelope('Санкт-Петербург'),
    chatId,
    senderIdentity: 'lead',
  });
  await processTelegramOwnerOnboarding({
    envelope: envelope('Лиговский пр., 108'),
    chatId,
    senderIdentity: 'lead',
  });
  await processTelegramOwnerOnboarding({
    envelope: wizardCb('obv2:type:Квартира'),
    chatId,
    senderIdentity: 'lead',
  });
  await processTelegramOwnerOnboarding({
    envelope: envelope('Апартаменты у Невского'),
    chatId,
    senderIdentity: 'lead',
  });
  await processTelegramOwnerOnboarding({
    envelope: wizardCb('obv2:chk_in:15:00'),
    chatId,
    senderIdentity: 'lead',
  });
  await processTelegramOwnerOnboarding({
    envelope: wizardCb('obv2:chk_out:11:00'),
    chatId,
    senderIdentity: 'lead',
  });
  await processTelegramOwnerOnboarding({
    envelope: wizardCb('obv2:rl_t:no_smoke'),
    chatId,
    senderIdentity: 'lead',
  });
  await processTelegramOwnerOnboarding({
    envelope: wizardCb('obv2:rl_done'),
    chatId,
    senderIdentity: 'lead',
  });
  await processTelegramOwnerOnboarding({
    envelope: envelope('ASI_Guest, пароль 12345678'),
    chatId,
    senderIdentity: 'lead',
  });
  await processTelegramOwnerOnboarding({
    envelope: wizardCb('obv2:ch_t:sutochno'),
    chatId,
    senderIdentity: 'lead',
  });
  await processTelegramOwnerOnboarding({
    envelope: wizardCb('obv2:ch_done'),
    chatId,
    senderIdentity: 'lead',
  });
  await processTelegramOwnerOnboarding({
    envelope: wizardCb('obv2:photo_later'),
    chatId,
    senderIdentity: 'lead',
  });
}

describe('Owner automation v1', () => {
  beforeEach(() => {
    __resetAutonomousSessionStoreForTests();
    crmRows.clear();
    insertedRows.length = 0;
    opsTaskCalls.length = 0;
    pilotChainCalls = 0;
  });

  it('asks unknown users to clarify owner vs guest', async () => {
    const route = await resolveCommunicationIdentityRoute({
      envelope: envelope('Здравствуйте'),
      identity: { role: 'unknown', entityType: 'unknown', confidence: 0, status: 'unresolved', reason: 'test' },
    });
    expect(route.route).toBe('unknown_clarify');
    expect(route.replyText).toContain('владелец/управляющий или гость');
    expect(route.shouldRunGuestConcierge).toBe(false);
  });

  it('starts onboarding with channel manager question as the first step', async () => {
    const result = await processTelegramOwnerOnboarding({
      envelope: envelope('Хочу подключить ASI'),
      chatId: 88001,
      senderIdentity: 'lead',
    });
    expect(result.replyText).toContain('У вас уже есть менеджер каналов?');
    expect(result.state.mk_phase).toBe('ask_has_cm');
    expect(insertedRows.filter((item) => item.table === 'crm_contacts')).toHaveLength(0);

    const started = await processTelegramOwnerOnboarding({
      envelope: mkCb('obmk:has:no'),
      chatId: 88001,
      senderIdentity: 'lead',
    });
    expect(started.replyText).toMatch(/город/i);
    expect(insertedRows.filter((item) => item.table === 'crm_contacts')).toHaveLength(1);
  });

  it('resumes onboarding after interruption without creating a second CRM lead', async () => {
    await processTelegramOwnerOnboarding({
      envelope: envelope('Хочу подключить ASI'),
      chatId: 88002,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: mkCb('obmk:has:no'),
      chatId: 88002,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: envelope('Казань'),
      chatId: 88002,
      senderIdentity: 'lead',
    });

    const paused = loadAutonomousSession(88002)?.collected_data;
    expect(paused?.owner_onboarding_city).toBe('Казань');

    const resumed = await processTelegramOwnerOnboarding({
      envelope: envelope('Баумана 5'),
      chatId: 88002,
      senderIdentity: 'lead',
    });

    expect(resumed.state.city).toBe('Казань');
    expect(resumed.state.address).toMatch(/Баумана/i);
    const contactIds = new Set(
      [...crmRows.values()].map((row) => String((row as { id?: string }).id ?? '')),
    );
    expect(contactIds.size).toBe(1);
  });

  it('does not create OPS task during normal step-by-step flow', async () => {
    await walkCoreSteps(88003);
    const blockerOps = opsTaskCalls.filter(
      (call) => (call.metadata as { integration?: string })?.integration === 'owner_onboarding',
    );
    expect(blockerOps).toHaveLength(0);
  });

  it('creates a deduplicated OPS task only when owner is blocked', async () => {
    await processTelegramOwnerOnboarding({
      envelope: envelope('Хочу подключить ASI'),
      chatId: 88004,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: mkCb('obmk:has:no'),
      chatId: 88004,
      senderIdentity: 'lead',
    });
    const blocked = await processTelegramOwnerOnboarding({
      envelope: envelope('позовите человека'),
      chatId: 88004,
      senderIdentity: 'lead',
    });
    expect(blocked.status).toBe('needs_operator');
    expect(opsTaskCalls).toHaveLength(1);
    expect(opsTaskCalls[0]?.dedupKey).toContain('owner_onboarding');

    await processTelegramOwnerOnboarding({
      envelope: envelope('всё ещё не понимаю'),
      chatId: 88004,
      senderIdentity: 'lead',
    });
    expect(opsTaskCalls).toHaveLength(1);
  });

  it('rejects service bot links as owner contact and does not complete the wizard', async () => {
    await walkCoreSteps(88008);
    const rejected = await processTelegramOwnerOnboarding({
      envelope: envelope('https://t.me/ASI_Support_Bot'),
      chatId: 88008,
      senderIdentity: 'lead',
    });

    expect(rejected.status).not.toBe('ready_for_channel_manager');
    expect(rejected.missing).toContain('owner_contact');
    expect(rejected.replyText).toContain('Это ссылка на наш бот');
    expect(rejected.state.owner_contact).toBeUndefined();
    expect(pilotChainCalls).toBe(0);
    expect(
      opsTaskCalls.filter(
        (call) => (call.metadata as { integration?: string })?.integration === 'owner_onboarding',
      ),
    ).toHaveLength(0);
  });

  it('reaches readiness, skips pilot chain, shows honest MK final message, and creates one OPS follow-up', async () => {
    await walkCoreSteps(88005);
    const ready = await processTelegramOwnerOnboarding({
      envelope: envelope('+79991234567'),
      chatId: 88005,
      senderIdentity: 'lead',
    });

    expect(ready.status).toBe('ready_for_channel_manager');
    expect(ready.replyText).toMatch(/Данные объекта собраны/i);
    expect(ready.replyText).toMatch(/подготовить объект к подключению через менеджер каналов/i);
    expect(ready.replyText).toMatch(/подобрать или подключить менеджер каналов/i);
    expect(ready.replyText).not.toMatch(/автоматическую подготовку подключения каналов/i);
    expect(ready.replyMarkup?.inline_keyboard?.[0]?.[0]?.text).toBe('Связаться с поддержкой');
    expect(pilotChainCalls).toBe(0);

    const followupOps = opsTaskCalls.filter(
      (call) =>
        (call.metadata as { mk_followup_kind?: string })?.mk_followup_kind ===
        'channel_manager_selection_needed',
    );
    expect(followupOps).toHaveLength(1);

    await processTelegramOwnerOnboarding({
      envelope: envelope('спасибо'),
      chatId: 88005,
      senderIdentity: 'lead',
    });
    expect(pilotChainCalls).toBe(0);
    expect(
      opsTaskCalls.filter(
        (call) =>
          (call.metadata as { mk_followup_kind?: string })?.mk_followup_kind ===
          'channel_manager_selection_needed',
      ),
    ).toHaveLength(1);
  });

  it('validates owner contact input for phones, usernames, and service bots', () => {
    expect(validateOwnerContactInput('+79991234567')).toEqual({ ok: true, contact: '+79991234567' });
    expect(validateOwnerContactInput('@real_owner')).toEqual({ ok: true, contact: '@real_owner' });
    expect(validateOwnerContactInput('писать сюда')).toEqual({ ok: true, contact: 'писать сюда' });
    expect(validateOwnerContactInput('https://t.me/ASI_Support_Bot')).toEqual({
      ok: false,
      reason: 'service_bot',
    });
    expect(validateOwnerContactInput('https://t.me/ASI_core_bot')).toEqual({
      ok: false,
      reason: 'service_bot',
    });
    expect(validateOwnerContactInput('')).toEqual({ ok: false, reason: 'empty' });
    expect(validateOwnerContactInput('ab')).toEqual({ ok: false, reason: 'short' });
  });

  it('keeps a single object registry entry through the full flow', async () => {
    await walkCoreSteps(88006);
    await processTelegramOwnerOnboarding({
      envelope: envelope('@owner_auto_v1'),
      chatId: 88006,
      senderIdentity: 'lead',
    });
    const registry = JSON.parse(
      String(loadAutonomousSession(88006)?.collected_data.owner_objects_registry ?? '{}'),
    );
    expect(registry.objects).toHaveLength(1);
    expect(registry.objects[0].objectId).toBe('OBJ-0001');
  });

  it('preserves collected city on CRM update when later step has no city', async () => {
    await processTelegramOwnerOnboarding({
      envelope: envelope('Хочу подключить ASI'),
      chatId: 88007,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: mkCb('obmk:has:no'),
      chatId: 88007,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: envelope('Санкт-Петербург'),
      chatId: 88007,
      senderIdentity: 'lead',
    });
    await processTelegramOwnerOnboarding({
      envelope: envelope('Лиговский 108'),
      chatId: 88007,
      senderIdentity: 'lead',
    });

    const updates = insertedRows.filter((item) => item.table === 'crm_contacts_update');
    const lastPatch = updates.at(-1)?.patch as { city?: string } | undefined;
    expect(lastPatch?.city).toBe('Санкт-Петербург');
  });

  it('stores custom channels without breaking wizard keyboards', () => {
    const labels = buildChannelsKeyboard([customChannelIdFromLabel('TravelLine')]).inline_keyboard
      .flat()
      .map((button) => button.text);
    expect(labels).toContain('✅ TravelLine');
    expect(buildRulesKeyboard([]).inline_keyboard.flat().map((button) => button.text)).toContain('Не курить');
  });
});
