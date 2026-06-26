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

import { __resetAutonomousSessionStoreForTests } from '../conversation-session-store';
import { processTelegramOwnerOnboarding } from '../telegram-owner-onboarding';
import { MK_CALLBACK_PREFIX } from '../owner-mk-onboarding-router';

function envelope(messageText: string, extra?: Partial<InboundMessageEnvelope>): InboundMessageEnvelope {
  const { metadata: extraMetadata, ...restExtra } = extra ?? {};
  return {
    channel: 'telegram',
    externalUserId: '99001',
    chatId: '99001',
    messageText,
    receivedAt: new Date(),
    update_id: 99_001,
    metadata: {
      telegram_chat_id: '99001',
      telegram_user_id: 99001,
      telegram_username: 'owner_mk_test',
      telegram_first_name: 'Олег',
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

function collectedCrmNotes(): string[] {
  return insertedRows
    .flatMap((item) => {
      const row = item.row as { notes?: unknown } | undefined;
      const patch = item.patch as { notes?: unknown } | undefined;
      return [row?.notes, patch?.notes];
    })
    .map((item) => String(item ?? ''))
    .filter(Boolean);
}

async function walkNoMkWizard(chatId: number): Promise<void> {
  await processTelegramOwnerOnboarding({ envelope: mkCb(`${MK_CALLBACK_PREFIX}has:no`), chatId, senderIdentity: 'lead' });
  await walkWizardCore(chatId);
}

async function walkWizardCore(chatId: number): Promise<void> {
  await processTelegramOwnerOnboarding({ envelope: envelope('Казань'), chatId, senderIdentity: 'lead' });
  await processTelegramOwnerOnboarding({ envelope: envelope('Баумана 5'), chatId, senderIdentity: 'lead' });
  await processTelegramOwnerOnboarding({ envelope: wizardCb('obv2:type:Квартира'), chatId, senderIdentity: 'lead' });
  await processTelegramOwnerOnboarding({ envelope: envelope('Апартаменты у Кремля'), chatId, senderIdentity: 'lead' });
  await processTelegramOwnerOnboarding({ envelope: wizardCb('obv2:chk_in:15:00'), chatId, senderIdentity: 'lead' });
  await processTelegramOwnerOnboarding({ envelope: wizardCb('obv2:chk_out:11:00'), chatId, senderIdentity: 'lead' });
  await processTelegramOwnerOnboarding({ envelope: wizardCb('obv2:rl_t:no_smoke'), chatId, senderIdentity: 'lead' });
  await processTelegramOwnerOnboarding({ envelope: wizardCb('obv2:rl_done'), chatId, senderIdentity: 'lead' });
  await processTelegramOwnerOnboarding({ envelope: envelope('ASI_Guest, пароль 12345678'), chatId, senderIdentity: 'lead' });
  await processTelegramOwnerOnboarding({ envelope: wizardCb('obv2:ch_t:sutochno'), chatId, senderIdentity: 'lead' });
  await processTelegramOwnerOnboarding({ envelope: wizardCb('obv2:ch_done'), chatId, senderIdentity: 'lead' });
  await processTelegramOwnerOnboarding({ envelope: wizardCb('obv2:photo_later'), chatId, senderIdentity: 'lead' });
}

describe('Owner onboarding MK-first routing', () => {
  beforeEach(() => {
    __resetAutonomousSessionStoreForTests();
    crmRows.clear();
    insertedRows.length = 0;
    opsTaskCalls.length = 0;
    pilotChainCalls = 0;
  });

  it('asks about channel manager as the first fork after connect intent', async () => {
    const result = await processTelegramOwnerOnboarding({
      envelope: envelope('Хочу подключить ASI'),
      chatId: 99001,
      senderIdentity: 'lead',
    });

    expect(result.replyText).toContain('У вас уже есть менеджер каналов?');
    expect(result.replyMarkup?.inline_keyboard?.[0]?.[0]?.text).toBe('Да, уже есть');
    expect(result.replyMarkup?.inline_keyboard?.[1]?.[0]?.text).toBe('Нет, пока нет');
    expect(result.replyMarkup?.inline_keyboard?.[2]?.[0]?.text).toBe('Не знаю, что это');
    expect(result.missing[0]).toBe('city');
    expect(result.state.mk_phase).toBe('ask_has_cm');
  });

  it('existing MK branch collects minimal data and creates channel_manager_existing_check OPS task', async () => {
    await processTelegramOwnerOnboarding({ envelope: envelope('Хочу подключить ASI'), chatId: 99002, senderIdentity: 'lead' });
    await processTelegramOwnerOnboarding({ envelope: mkCb(`${MK_CALLBACK_PREFIX}has:yes`), chatId: 99002, senderIdentity: 'lead' });
    await processTelegramOwnerOnboarding({ envelope: mkCb(`${MK_CALLBACK_PREFIX}cm:bnovo`), chatId: 99002, senderIdentity: 'lead' });
    await processTelegramOwnerOnboarding({ envelope: mkCb(`${MK_CALLBACK_PREFIX}prop:yes`), chatId: 99002, senderIdentity: 'lead' });

    const afterProp = await processTelegramOwnerOnboarding({
      envelope: envelope('Апартаменты на Невском'),
      chatId: 99002,
      senderIdentity: 'lead',
    });
    expect(afterProp.state.mk_collection_mode).toBe('minimal');
    expect(afterProp.missing).toContain('city');

    await processTelegramOwnerOnboarding({ envelope: envelope('Санкт-Петербург'), chatId: 99002, senderIdentity: 'lead' });
    await processTelegramOwnerOnboarding({ envelope: envelope('+79991112233'), chatId: 99002, senderIdentity: 'lead' });
    const placement = await processTelegramOwnerOnboarding({
      envelope: mkCb(`${MK_CALLBACK_PREFIX}placement:skip`),
      chatId: 99002,
      senderIdentity: 'lead',
    });

    expect(placement.status).toBe('missing_required_data');
    expect(placement.replyText).toContain('Кто со стороны объекта будет отвечать за подключение менеджера каналов?');
    expect(placement.replyMarkup?.inline_keyboard?.flat().map((button) => button.text)).toEqual(
      expect.arrayContaining(['Я сам', 'Управляющий', 'Администратор', 'Другой сотрудник', 'Пока не знаю', 'Нужна помощь ASI']),
    );

    await processTelegramOwnerOnboarding({
      envelope: mkCb(`${MK_CALLBACK_PREFIX}resp:manager`),
      chatId: 99002,
      senderIdentity: 'lead',
    });
    const responsible = await processTelegramOwnerOnboarding({
      envelope: envelope('@manager_nevsky'),
      chatId: 99002,
      senderIdentity: 'lead',
    });

    expect(responsible.status).toBe('ready_for_channel_manager');
    expect(responsible.replyText).toContain('Поняла. Я подготовлю для него короткую инструкцию');
    expect(responsible.replyMarkup?.inline_keyboard?.flat().map((button) => button.text)).toContain('Статус подключения');
    expect(placement.state.selected_channel_manager).toBe('bnovo');
    expect(responsible.state.mk_connection_state).toMatchObject({
      selectedChannelManager: 'Bnovo',
      channelManagerRoute: 'has_manager',
      objectInChannelManager: 'yes',
      connectionStatus: 'needs_manager_check',
      mkResponsibleRole: 'manager',
      mkResponsibleContact: '@manager_nevsky',
      nextOperatorAction: 'Связаться с ответственным и провести его по подключению менеджера каналов',
    });
    expect(pilotChainCalls).toBe(0);

    const followupOps = opsTaskCalls.filter(
      (call) =>
        (call.metadata as { mk_followup_kind?: string })?.mk_followup_kind ===
        'channel_manager_existing_check',
    );
    expect(followupOps).toHaveLength(1);
    expect(String(followupOps[0]?.description ?? '')).toContain('Тип: channel_manager_existing_check');
    expect(String(followupOps[0]?.description ?? '')).toContain('Ответственный за подключение: управляющий');
    expect(String(followupOps[0]?.description ?? '')).toContain('Контакт ответственного: @manager_nevsky');
    expect(String(followupOps[0]?.description ?? '')).toContain('- связаться с ответственным');
    expect(followupOps[0]?.metadata).toMatchObject({
      type: 'channel_manager_existing_check',
      mk_responsible_role: 'manager',
      mk_responsible_contact: '@manager_nevsky',
      checklist: expect.arrayContaining(['связаться с ответственным']),
    });

    expect(collectedCrmNotes().some((note) => note.includes('Статус подключения: needs_manager_check'))).toBe(true);
    expect(collectedCrmNotes().some((note) => note.includes('Выбранный МК: Bnovo'))).toBe(true);
    expect(collectedCrmNotes().some((note) => note.includes('Ответственный роль: manager'))).toBe(true);
    expect(collectedCrmNotes().some((note) => note.includes('Ответственный контакт: @manager_nevsky'))).toBe(true);

    const status = await processTelegramOwnerOnboarding({
      envelope: mkCb(`${MK_CALLBACK_PREFIX}status`),
      chatId: 99002,
      senderIdentity: 'lead',
    });
    expect(status.replyText).toContain('Ответственный: управляющий, @manager_nevsky');
    expect(status.replyText).toContain('оператор напишет ответственному');

    await processTelegramOwnerOnboarding({ envelope: envelope('спасибо'), chatId: 99002, senderIdentity: 'lead' });
    expect(
      opsTaskCalls.filter(
        (call) =>
          (call.metadata as { mk_followup_kind?: string })?.mk_followup_kind ===
          'channel_manager_existing_check',
      ),
    ).toHaveLength(1);
  });

  it('no MK branch runs full wizard with placement wording and channel_manager_selection_needed OPS', async () => {
    await processTelegramOwnerOnboarding({ envelope: envelope('Хочу подключить ASI'), chatId: 99003, senderIdentity: 'lead' });
    const noMk = await processTelegramOwnerOnboarding({
      envelope: mkCb(`${MK_CALLBACK_PREFIX}has:no`),
      chatId: 99003,
      senderIdentity: 'lead',
    });
    expect(noMk.state.mk_route).toBe('no_cm');
    expect(noMk.replyText).toMatch(/город/i);

    await walkNoMkWizard(99003);
    const responsibleQuestion = await processTelegramOwnerOnboarding({
      envelope: envelope('+79993334455'),
      chatId: 99003,
      senderIdentity: 'lead',
    });

    expect(responsibleQuestion.status).toBe('missing_required_data');
    expect(responsibleQuestion.replyText).toContain('Кто со стороны объекта будет отвечать');

    const ready = await processTelegramOwnerOnboarding({
      envelope: mkCb(`${MK_CALLBACK_PREFIX}resp:owner`),
      chatId: 99003,
      senderIdentity: 'lead',
    });

    expect(ready.status).toBe('ready_for_channel_manager');
    expect(ready.replyText).toContain('Хорошо. Я буду считать вас ответственным');
    expect(ready.state.target_placement_channels).toEqual(expect.arrayContaining(['Суточно']));
    expect(ready.state.mk_connection_state).toMatchObject({
      channelManagerRoute: 'no_manager',
      objectInChannelManager: 'unknown',
      connectionStatus: 'needs_manager_selection',
      mkResponsibleRole: 'owner',
      mkResponsibleContact: '+79993334455',
      nextOperatorAction: 'Связаться с ответственным и провести его по подключению менеджера каналов',
    });
    expect(pilotChainCalls).toBe(0);

    const followupOps = opsTaskCalls.filter(
      (call) =>
        (call.metadata as { mk_followup_kind?: string })?.mk_followup_kind ===
        'channel_manager_selection_needed',
    );
    expect(followupOps).toHaveLength(1);
    expect(String(followupOps[0]?.description ?? '')).toContain('Тип: channel_manager_selection_needed');
    expect(String(followupOps[0]?.description ?? '')).toContain('Ответственный за подключение: владелец');

    const status = await processTelegramOwnerOnboarding({
      envelope: mkCb(`${MK_CALLBACK_PREFIX}status`),
      chatId: 99003,
      senderIdentity: 'lead',
    });
    expect(status.replyText).toContain('Ответственный: владелец, +79993334455');
    expect(
      opsTaskCalls.filter(
        (call) =>
          (call.metadata as { mk_followup_kind?: string })?.mk_followup_kind ===
          'channel_manager_selection_needed',
      ),
    ).toHaveLength(1);
  });

  it('unknown MK branch explains and routes to channel_manager_explain_and_select OPS', async () => {
    await processTelegramOwnerOnboarding({ envelope: envelope('Хочу подключить ASI'), chatId: 99004, senderIdentity: 'lead' });
    const explain = await processTelegramOwnerOnboarding({
      envelope: mkCb(`${MK_CALLBACK_PREFIX}has:unknown`),
      chatId: 99004,
      senderIdentity: 'lead',
    });
    expect(explain.replyText).toMatch(/Менеджер каналов — это система/i);
    expect(explain.replyText).not.toMatch(/API|CRM|OPS/i);

    await processTelegramOwnerOnboarding({
      envelope: mkCb(`${MK_CALLBACK_PREFIX}explain:help`),
      chatId: 99004,
      senderIdentity: 'lead',
    });
    await walkWizardCore(99004);
    const responsibleQuestion = await processTelegramOwnerOnboarding({
      envelope: envelope('@owner_mk_test'),
      chatId: 99004,
      senderIdentity: 'lead',
    });

    expect(responsibleQuestion.replyText).toContain('Кто со стороны объекта будет отвечать');

    const ready = await processTelegramOwnerOnboarding({
      envelope: mkCb(`${MK_CALLBACK_PREFIX}resp:unknown`),
      chatId: 99004,
      senderIdentity: 'lead',
    });

    expect(ready.state.mk_route).toBe('unknown_help');
    expect(ready.replyText).toContain('ответственный ещё не выбран');
    expect(ready.state.mk_connection_state).toMatchObject({
      channelManagerRoute: 'unknown',
      connectionStatus: 'waiting_for_owner',
      mkResponsibleRole: 'unknown',
      nextOperatorAction: 'Уточнить у владельца, кто будет отвечать за подключение менеджера каналов',
    });
    const followupOps = opsTaskCalls.filter(
      (call) =>
        (call.metadata as { mk_followup_kind?: string })?.mk_followup_kind ===
        'channel_manager_explain_and_select',
    );
    expect(followupOps).toHaveLength(1);
    expect(String(followupOps[0]?.description ?? '')).toContain('Тип: channel_manager_explain_and_select');
    expect(String(followupOps[0]?.description ?? '')).toContain('Ответственный за подключение: ответственный ещё не выбран');
    expect(String(followupOps[0]?.description ?? '')).toContain('- уточнить у владельца, кто будет отвечать за подключение МК');

    const status = await processTelegramOwnerOnboarding({
      envelope: mkCb(`${MK_CALLBACK_PREFIX}status`),
      chatId: 99004,
      senderIdentity: 'lead',
    });
    expect(status.replyText).toContain('Следующий шаг — выбрать ответственного');
  });
});
