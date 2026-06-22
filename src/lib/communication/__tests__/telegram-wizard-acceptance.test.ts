import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboundMessageEnvelope } from '../types';

const crmRows = new Map<string, Record<string, unknown>>();
const insertedRows: Array<Record<string, unknown>> = [];
const updatedRows: Array<{ id: string; patch: Record<string, unknown> }> = [];
const crmEvents: Array<Record<string, unknown>> = [];

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
    in: vi.fn(() => query),
    order: vi.fn(() => query),
    limit: vi.fn(() => query),
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
      if (table === 'crm_events') crmEvents.push(row);
      const id = `crm-${insertedRows.length + 1}`;
      insertedRows.push({ table, row: { ...row, id } });
      return {
        select: () => ({
          single: async () => ({ data: { id }, error: null }),
        }),
      };
    }),
    then: undefined,
  };
  query.then = (resolve: (value: { data: unknown[]; error: null }) => void) =>
    Promise.resolve({
      data:
        table === 'crm_events'
          ? crmEvents.map((item, index) => ({
              id: `evt-${index}`,
              contact_id: item.contact_id,
              event_type: item.event_type,
              message_text: item.message_text,
              metadata: item.metadata ?? {},
              created_at: item.created_at ?? new Date().toISOString(),
            }))
          : [],
      error: null,
    }).then(resolve);
  return query;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => makeQuery(table),
  },
}));

vi.mock('@/lib/crm/repository', () => ({
  listCrmContacts: vi.fn(async () => {
    const contacts = [];
    for (const row of insertedRows.filter((item) => item.table === 'crm_contacts')) {
      const data = row.row as Record<string, unknown>;
      const notes = String(data.notes ?? '');
      const statusLine = notes.split('\n').find((line) => line.startsWith('Статус:')) ?? '';
      const statusLabel = statusLine.replace('Статус:', '').trim();
      const status =
        statusLabel === 'ready_for_channel_manager' || statusLabel === 'Готов к Менеджеру каналов'
          ? 'ready_for_channel_manager'
          : statusLabel;
      const readinessLine = notes.split('\n').find((line) => line.startsWith('Готовность:')) ?? '';
      const readinessPercent = Number(readinessLine.replace(/[^\d]/g, '')) || null;
      const channelsLine = notes.split('\n').find((line) => line.startsWith('Каналы:')) ?? '';
      const rulesLine = notes.split('\n').find((line) => line.startsWith('Правила:')) ?? '';
      contacts.push({
        id: String(data.id ?? `crm-${contacts.length + 1}`),
        name: data.name,
        phone: data.contact,
        telegramUsername: data.telegram_username,
        email: null,
        role: 'unknown',
        source: 'telegram',
        objectsCount: 1,
        city: data.city ?? '',
        note: notes,
        status: data.status,
        communicationStatus: data.communication_status,
        lastContactAt: data.last_activity_at,
        nextStep: data.next_action,
        nextActionAt: null,
        createdAt: data.created_at,
        updatedAt: data.last_activity_at,
        onboarding: {
          status,
          statusLabel: status,
          missing: [],
          lastMessage: '',
          channelManagerHref: '/dashboard/channel-connections?source=telegram_onboarding',
          readinessPercent,
          readinessStatusLabel: status,
          nextBestStep: String(data.next_action ?? ''),
          missingOptional: [],
          channels: channelsLine
            ? channelsLine
                .replace('Каналы:', '')
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean)
            : [],
          rules: rulesLine
            ? rulesLine
                .replace('Правила:', '')
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean)
            : [],
        },
        ownerObjects: [],
        activeObjectTitle: null,
      });
    }
    return contacts;
  }),
}));

import { __resetAutonomousSessionStoreForTests } from '../conversation-session-store';
import { __setOwnerOnboardingSmartParserLlmOverrideForTests } from '../owner-onboarding-smart-parser';
import {
  buildWizardAcceptanceEnvelope,
  buildWizardV2AcceptanceSteps,
  DEFAULT_WIZARD_ACCEPTANCE_CHAT_ID,
  formatWizardAcceptanceTable,
  isWizardAcceptanceChatAllowed,
  isWizardAcceptanceReadinessFeedSignal,
  resetWizardAcceptanceState,
  runWizardAcceptanceScenario,
  runWizardAcceptanceStep,
  snapshotWizardAcceptanceObjects,
  verifyPreservedObjectsUnchanged,
  WIZARD_ACCEPTANCE_USERNAME,
} from '../telegram-wizard-acceptance';
import { persistOwnerObjectState, readOwnerObjectState } from '../telegram-owner-object-session';
import { processTelegramOwnerOnboarding } from '../telegram-owner-onboarding';

function envelope(messageText: string, extra?: Partial<InboundMessageEnvelope>): InboundMessageEnvelope {
  return {
    channel: 'telegram',
    externalUserId: String(DEFAULT_WIZARD_ACCEPTANCE_CHAT_ID),
    chatId: String(DEFAULT_WIZARD_ACCEPTANCE_CHAT_ID),
    messageText,
    receivedAt: new Date(),
    update_id: 99_001,
    metadata: {
      telegram_chat_id: String(DEFAULT_WIZARD_ACCEPTANCE_CHAT_ID),
      telegram_user_id: DEFAULT_WIZARD_ACCEPTANCE_CHAT_ID,
      telegram_username: WIZARD_ACCEPTANCE_USERNAME,
      telegram_first_name: 'Acceptance',
      providerMessageId: `msg-${Math.random()}`,
      ...extra?.metadata,
    },
    ...extra,
  };
}

function wizardEnvelope(callbackData: string): InboundMessageEnvelope {
  return envelope('', {
    metadata: {
      telegram_onboarding_wizard_callback: callbackData,
    },
  });
}

describe('telegram wizard acceptance helpers', () => {
  beforeEach(() => {
    __resetAutonomousSessionStoreForTests();
    crmRows.clear();
    insertedRows.length = 0;
    updatedRows.length = 0;
    crmEvents.length = 0;
    __setOwnerOnboardingSmartParserLlmOverrideForTests(null);
    process.env.WIZARD_ACCEPTANCE_CHAT_IDS = String(DEFAULT_WIZARD_ACCEPTANCE_CHAT_ID);
  });

  it('allowlists dedicated acceptance chat and blocks protected owner chat by default', () => {
    expect(isWizardAcceptanceChatAllowed(DEFAULT_WIZARD_ACCEPTANCE_CHAT_ID)).toBe(true);
    expect(isWizardAcceptanceChatAllowed(931919812)).toBe(false);
  });

  it('recognizes readiness feed from channel-manager transition activity', () => {
    expect(
      isWizardAcceptanceReadinessFeedSignal({
        readinessEvents: [],
        readinessPercent: null,
        onboardingStatus: 'ready_for_channel_manager',
        activityEvents: ['Подготовила переход к Менеджеру каналов', 'Каналы сохранены'],
      }),
    ).toBe(true);
  });

  it('builds callback simulation envelope', () => {
    const env = buildWizardAcceptanceEnvelope({
      chatId: DEFAULT_WIZARD_ACCEPTANCE_CHAT_ID,
      callbackData: 'obv2:ch_t:sutochno',
    });
    expect(env.metadata?.telegram_onboarding_wizard_callback).toBe('obv2:ch_t:sutochno');
    expect(env.metadata?.telegram_username).toBe(WIZARD_ACCEPTANCE_USERNAME);
  });

  it('formats acceptance table rows', () => {
    const table = formatWizardAcceptanceTable([
      {
        id: 'start',
        label: 'Старт',
        input: 'Хочу подключить квартиру',
        expected: 'reply',
        actual: 'ok',
        pass: true,
        failures: [],
        readinessPercent: 0,
        status: 'onboarding_started',
        editInPlace: false,
      },
    ]);
    expect(table).toContain('Step');
    expect(table).toContain('PASS');
  });

  it('resets only allowlisted chat state', () => {
    const reset = resetWizardAcceptanceState(DEFAULT_WIZARD_ACCEPTANCE_CHAT_ID);
    expect(reset.ok).toBe(true);
    expect(reset.previousObjectCount).toBe(0);
  });
});

describe('telegram wizard acceptance scenario', () => {
  beforeEach(() => {
    __resetAutonomousSessionStoreForTests();
    insertedRows.length = 0;
    updatedRows.length = 0;
    crmEvents.length = 0;
    __setOwnerOnboardingSmartParserLlmOverrideForTests(null);
    process.env.WIZARD_ACCEPTANCE_CHAT_IDS = String(DEFAULT_WIZARD_ACCEPTANCE_CHAT_ID);
    resetWizardAcceptanceState(DEFAULT_WIZARD_ACCEPTANCE_CHAT_ID);
  });

  it('runs full happy path with custom channels and readiness 100%', async () => {
    const run = await runWizardAcceptanceScenario({
      chatId: DEFAULT_WIZARD_ACCEPTANCE_CHAT_ID,
      resetTestState: true,
    });

    expect(run.ok).toBe(true);
    expect(run.steps.every((step) => step.pass)).toBe(true);
    expect(run.finalState?.status).toBe('ready_for_channel_manager');
    expect(run.finalState?.checkout_time).toBe('11:00');
    expect(run.finalState?.photos_intent).toBe('later');
    expect(run.readinessPercent).toBe(100);
    expect(run.channels).toEqual(
      expect.arrayContaining(['Суточно', 'Авито', 'Собственный сайт', 'Telegram', 'TravelLine', 'МирКвартир']),
    );
    expect(run.rules).toEqual(
      expect.arrayContaining(['Не курить', 'Без вечеринок', 'Тихие часы после 22:00']),
    );
  });

  it('uses edit-in-place for channel toggles', async () => {
    await runWizardAcceptanceStep({
      chatId: DEFAULT_WIZARD_ACCEPTANCE_CHAT_ID,
      text: 'Хочу подключить квартиру',
      step: buildWizardV2AcceptanceSteps()[0],
    });
    await runWizardAcceptanceStep({
      chatId: DEFAULT_WIZARD_ACCEPTANCE_CHAT_ID,
      text: 'Санкт-Петербург, Лиговский проспект, 108',
    });
    await runWizardAcceptanceStep({ chatId: DEFAULT_WIZARD_ACCEPTANCE_CHAT_ID, callbackData: 'obv2:type:Квартира' });
    await runWizardAcceptanceStep({ chatId: DEFAULT_WIZARD_ACCEPTANCE_CHAT_ID, callbackData: 'obv2:chk_in:14:00' });
    await runWizardAcceptanceStep({ chatId: DEFAULT_WIZARD_ACCEPTANCE_CHAT_ID, callbackData: 'obv2:chk_out:11:00' });

    const toggle = await runWizardAcceptanceStep({
      chatId: DEFAULT_WIZARD_ACCEPTANCE_CHAT_ID,
      callbackData: 'obv2:ch_t:sutochno',
      step: buildWizardV2AcceptanceSteps().find((item) => item.id === 'channel_sutochno'),
    });
    expect(toggle.pass).toBe(true);
    expect(toggle.editInPlace).toBe(true);
  });

  it('preserves existing object snapshots when requested', async () => {
    await processTelegramOwnerOnboarding({
      envelope: envelope('Хочу подключить квартиру'),
      chatId: DEFAULT_WIZARD_ACCEPTANCE_CHAT_ID,
      senderIdentity: 'lead',
    });
    const seeded = readOwnerObjectState(DEFAULT_WIZARD_ACCEPTANCE_CHAT_ID, 'telegram', 'OBJ-0001');
    seeded.address = 'Сохранённый адрес OBJ-0001';
    seeded.status = 'ready_for_channel_manager';
    seeded.checkout_time = '10:00';
    persistOwnerObjectState(DEFAULT_WIZARD_ACCEPTANCE_CHAT_ID, 'telegram', 'OBJ-0001', seeded);

    const before = snapshotWizardAcceptanceObjects(DEFAULT_WIZARD_ACCEPTANCE_CHAT_ID);
    const after = snapshotWizardAcceptanceObjects(DEFAULT_WIZARD_ACCEPTANCE_CHAT_ID);
    const safety = verifyPreservedObjectsUnchanged(before, after, ['OBJ-0001']);
    expect(safety.ok).toBe(true);
  });
});
