import { supabase } from '@/lib/supabase';
import { buildCardActivities } from '@/lib/crm/activity-feed';
import { buildQueueItem } from '@/lib/crm/queue';
import { listCrmEventsByContactIds } from '@/lib/crm/queue-events';
import type { CrmEventRow } from '@/lib/crm/queue-events';
import { listCrmContacts } from '@/lib/crm/repository';
import type { CrmContact } from '@/lib/crm/types';
import {
  resetAutonomousSessionSnapshot,
  patchAutonomousSessionCollectedData,
  getOrCreateAutonomousSession,
} from './conversation-session-store';
import { isProtectedOwnerChatId } from './telegram-outbound-safe-mode';
import type { InboundMessageEnvelope } from './types';
import {
  processTelegramOwnerOnboarding,
  type OwnerOnboardingResult,
  type OwnerOnboardingState,
} from './telegram-owner-onboarding';
import {
  loadOwnerObjectsRegistry,
  readOwnerObjectState,
  serializeOwnerObjectState,
  getActiveOwnerObjectId,
  type OwnerObjectsRegistry,
  OWNER_OBJECTS_REGISTRY_KEY,
  OWNER_OBJECT_STATE_PREFIX,
} from './telegram-owner-object-session';
import {
  CUSTOM_CHANNEL_INPUT_PROMPT_RU,
  customChannelIdFromLabel,
  labelsFromChannelIds,
  labelsFromRuleIds,
} from './telegram-owner-onboarding-wizard';

export const WIZARD_ACCEPTANCE_USERNAME = 'wizard_accept_v2';
export const DEFAULT_WIZARD_ACCEPTANCE_CHAT_ID = 99445001;

export type WizardAcceptanceStepInput = {
  id: string;
  label: string;
  text?: string;
  callbackData?: string;
  expectReplyIncludes?: string[];
  expectReplyMatches?: RegExp[];
  expectEditInPlace?: boolean;
  expectNextField?: string;
  expectReadinessAtLeast?: number;
  expectMarkupIncludes?: string[];
  assertState?: (state: OwnerOnboardingState, result: OwnerOnboardingResult) => string | null;
};

export type WizardAcceptanceStepResult = {
  id: string;
  label: string;
  input: string;
  expected: string;
  actual: string;
  pass: boolean;
  failures: string[];
  readinessPercent: number | null;
  status: string;
  editInPlace: boolean;
  objectId?: string;
  crmContactId?: string;
};

export type WizardAcceptanceResetResult = {
  ok: true;
  chatId: number;
  previousRegistry: OwnerObjectsRegistry | null;
  previousObjectCount: number;
  previousActiveObjectId: string | null;
};

export type WizardAcceptanceObjectsSnapshot = {
  registry: OwnerObjectsRegistry | null;
  objectStates: Record<string, string>;
};

export type WizardAcceptanceCrmValidation = {
  ok: boolean;
  failures: string[];
  contactId: string | null;
  queueColumn: string | null;
  readinessPercent: number | null;
  onboardingStatus: string | null;
  channels: string[];
  rules: string[];
  nextBestStep: string | null;
  activityEvents: string[];
  readinessEvents: string[];
  channelEvents: string[];
};

export type WizardAcceptanceRunResult = {
  ok: boolean;
  chatId: number;
  steps: WizardAcceptanceStepResult[];
  finalState: OwnerOnboardingState | null;
  objectId: string | null;
  readinessPercent: number | null;
  channels: string[];
  rules: string[];
  crm: WizardAcceptanceCrmValidation;
  objectsSafety: {
    ok: boolean;
    failures: string[];
    preservedObjectIds: string[];
  };
};

function text(value: unknown, max = 400): string {
  return String(value ?? '').trim().slice(0, max);
}

export function parseWizardAcceptanceChatAllowlist(): Set<string> {
  const raw = process.env.WIZARD_ACCEPTANCE_CHAT_IDS?.trim();
  const defaults = [
    String(DEFAULT_WIZARD_ACCEPTANCE_CHAT_ID),
    process.env.WIZARD_ACCEPTANCE_CHAT_ID?.trim(),
    process.env.TELEGRAM_TEST_CHAT_ID?.trim(),
  ].filter(Boolean) as string[];
  const ids = raw ? raw.split(/[,;\s]+/) : defaults;
  return new Set(ids.map((item) => item.trim()).filter(Boolean));
}

export function isWizardAcceptanceChatAllowed(chatId: number | string): boolean {
  const normalized = String(chatId).trim();
  if (!normalized) return false;
  if (isProtectedOwnerChatId(normalized) && !parseWizardAcceptanceChatAllowlist().has(normalized)) {
    return false;
  }
  return parseWizardAcceptanceChatAllowlist().has(normalized);
}

export function assertWizardAcceptanceChatAllowed(chatId: number | string): void {
  const normalized = String(chatId).trim();
  if (!isWizardAcceptanceChatAllowed(normalized)) {
    throw new Error(`chat_id_not_allowlisted:${normalized}`);
  }
}

export function buildWizardAcceptanceEnvelope(params: {
  chatId: number;
  text?: string;
  callbackData?: string;
  updateId?: number;
}): InboundMessageEnvelope {
  const chatId = params.chatId;
  const updateId = params.updateId ?? Date.now();
  return {
    channel: 'telegram',
    externalUserId: String(chatId),
    chatId: String(chatId),
    messageText: text(params.text),
    receivedAt: new Date(),
    update_id: updateId,
    metadata: {
      telegram_chat_id: String(chatId),
      telegram_user_id: chatId,
      telegram_username: WIZARD_ACCEPTANCE_USERNAME,
      telegram_first_name: 'Wizard Acceptance',
      providerMessageId: `wizard-acceptance-${updateId}`,
      externalMessageId: `wizard-acceptance-${updateId}`,
      acceptance_run: true,
      syntheticInbound: true,
      ...(params.callbackData
        ? {
            telegram_onboarding_wizard_callback: params.callbackData,
            telegram_callback_data: params.callbackData,
            telegram_event_type: 'callback_query',
          }
        : {}),
    },
  };
}

export function snapshotWizardAcceptanceObjects(chatId: number): WizardAcceptanceObjectsSnapshot {
  const registry = loadOwnerObjectsRegistry(chatId);
  const objectStates: Record<string, string> = {};
  if (!registry) return { registry: null, objectStates };

  for (const item of registry.objects) {
    const state = readOwnerObjectState(chatId, 'telegram', item.objectId);
    objectStates[item.objectId] = serializeOwnerObjectState(state);
  }
  return { registry, objectStates };
}

export function verifyPreservedObjectsUnchanged(
  before: WizardAcceptanceObjectsSnapshot,
  after: WizardAcceptanceObjectsSnapshot,
  preservedObjectIds: string[],
): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  for (const objectId of preservedObjectIds) {
    const beforeState = before.objectStates[objectId];
    const afterState = after.objectStates[objectId];
    if (!beforeState) {
      failures.push(`missing before snapshot for ${objectId}`);
      continue;
    }
    if (!afterState) {
      failures.push(`object ${objectId} disappeared after acceptance run`);
      continue;
    }
    if (beforeState !== afterState) {
      failures.push(`object ${objectId} state changed during acceptance run`);
    }
  }
  return { ok: failures.length === 0, failures };
}

export function resetWizardAcceptanceState(chatId: number): WizardAcceptanceResetResult {
  assertWizardAcceptanceChatAllowed(chatId);
  const previousRegistry = loadOwnerObjectsRegistry(chatId);
  const previousObjectCount = previousRegistry?.objects.length ?? 0;
  const previousActiveObjectId = previousRegistry?.activeObjectId ?? null;

  resetAutonomousSessionSnapshot({ chatId, channel: 'telegram', preserveIdentity: false });
  getOrCreateAutonomousSession(chatId, 'telegram');
  const clearKeys = [
    OWNER_OBJECTS_REGISTRY_KEY,
    'owner_active_object_id',
    ...(previousRegistry?.objects ?? []).map((item) => `${OWNER_OBJECT_STATE_PREFIX}${item.objectId}`),
  ];
  patchAutonomousSessionCollectedData({
    chatId,
    channel: 'telegram',
    clear: clearKeys,
  });

  return {
    ok: true,
    chatId,
    previousRegistry,
    previousObjectCount,
    previousActiveObjectId,
  };
}

export function buildWizardV2AcceptanceSteps(): WizardAcceptanceStepInput[] {
  return [
    {
      id: 'start',
      label: 'Старт онбординга',
      text: 'Хочу подключить квартиру',
      expectReplyIncludes: ['адрес', 'Укажите'],
      expectReadinessAtLeast: 0,
    },
    {
      id: 'address',
      label: 'Адрес',
      text: 'Санкт-Петербург, Лиговский проспект, 108',
      expectReplyMatches: [/Шаг 2 из 8/i],
      expectReadinessAtLeast: 10,
      expectNextField: 'object_type',
    },
    {
      id: 'type',
      label: 'Тип: Квартира',
      callbackData: 'obv2:type:Квартира',
      expectReplyIncludes: ['Тип объекта сохранён', 'заезд'],
      expectReadinessAtLeast: 20,
    },
    {
      id: 'checkin',
      label: 'Заезд 14:00',
      callbackData: 'obv2:chk_in:14:00',
      expectReplyIncludes: ['Время заезда сохранено', 'выезд'],
      assertState: (state) => (state.checkin_time === '14:00' ? null : 'checkin_time != 14:00'),
    },
    {
      id: 'checkout',
      label: 'Выезд 11:00',
      callbackData: 'obv2:chk_out:11:00',
      expectReplyIncludes: ['Время выезда сохранено', 'канал'],
      assertState: (state) => (state.checkout_time === '11:00' ? null : 'checkout_time != 11:00'),
    },
    {
      id: 'channel_sutochno',
      label: 'Канал: Суточно',
      callbackData: 'obv2:ch_t:sutochno',
      expectEditInPlace: true,
      expectMarkupIncludes: ['✅ Суточно'],
    },
    {
      id: 'channel_avito',
      label: 'Канал: Авито',
      callbackData: 'obv2:ch_t:avito',
      expectEditInPlace: true,
      expectMarkupIncludes: ['✅ Суточно', '✅ Авито'],
    },
    {
      id: 'channel_own_site',
      label: 'Канал: Собственный сайт',
      callbackData: 'obv2:ch_t:own_site',
      expectEditInPlace: true,
      expectMarkupIncludes: ['✅ Собственный сайт'],
    },
    {
      id: 'channel_telegram',
      label: 'Канал: Telegram',
      callbackData: 'obv2:ch_t:telegram',
      expectEditInPlace: true,
      expectMarkupIncludes: ['✅ Telegram'],
    },
    {
      id: 'channel_custom_prompt',
      label: 'Свой вариант',
      callbackData: 'obv2:ch_custom',
      expectReplyIncludes: [CUSTOM_CHANNEL_INPUT_PROMPT_RU.split('\n')[0]],
    },
    {
      id: 'channel_custom_text',
      label: 'Кастомные каналы',
      text: 'TravelLine, МирКвартир',
      expectMarkupIncludes: ['✅ TravelLine', '✅ МирКвартир'],
      assertState: (state) => {
        const draft = state.channels_draft ?? [];
        const travelLine = customChannelIdFromLabel('TravelLine');
        const mir = customChannelIdFromLabel('МирКвартир');
        if (!draft.includes(travelLine) || !draft.includes(mir)) {
          return 'custom channels missing from channels_draft';
        }
        return null;
      },
    },
    {
      id: 'channels_done',
      label: 'Готово (каналы)',
      callbackData: 'obv2:ch_done',
      expectReplyIncludes: ['Каналы сохранены', 'правил'],
      expectEditInPlace: false,
      assertState: (state) => {
        const labels = state.channels_list ?? [];
        const required = ['Суточно', 'Авито', 'Собственный сайт', 'Telegram', 'TravelLine', 'МирКвартир'];
        const missing = required.filter((item) => !labels.includes(item));
        return missing.length ? `channels_list missing: ${missing.join(', ')}` : null;
      },
    },
    {
      id: 'rule_no_smoke',
      label: 'Правило: Не курить',
      callbackData: 'obv2:rl_t:no_smoke',
      expectEditInPlace: true,
      expectMarkupIncludes: ['✅ Не курить'],
    },
    {
      id: 'rule_no_parties',
      label: 'Правило: Без вечеринок',
      callbackData: 'obv2:rl_t:no_parties',
      expectEditInPlace: true,
      expectMarkupIncludes: ['✅ Без вечеринок'],
    },
    {
      id: 'rule_quiet_hours',
      label: 'Правило: Тихие часы',
      callbackData: 'obv2:rl_t:quiet_hours',
      expectEditInPlace: true,
      expectMarkupIncludes: ['✅ Тихие часы после 22:00'],
    },
    {
      id: 'rules_done',
      label: 'Готово (правила)',
      callbackData: 'obv2:rl_done',
      expectReplyIncludes: ['Правила сохранены', 'Wi-Fi'],
      expectEditInPlace: false,
      assertState: (state) => {
        const required = ['Не курить', 'Без вечеринок', 'Тихие часы после 22:00'];
        const rules = state.rules ?? [];
        const missing = required.filter((item) => !rules.includes(item));
        return missing.length ? `rules missing: ${missing.join(', ')}` : null;
      },
    },
    {
      id: 'wifi',
      label: 'Wi-Fi',
      text: 'Wi-Fi: ASI-Test-WiFi, пароль test12345',
      expectReplyIncludes: ['Wi-Fi сохранён', 'фото', 'Фото'],
      assertState: (state) =>
        state.wifi_password === 'test12345' && (state.wifi_name ?? '').includes('ASI-Test-WiFi')
          ? null
          : 'wifi credentials not saved',
    },
    {
      id: 'photos_later',
      label: 'Фото: Добавлю позже',
      callbackData: 'obv2:photo_later',
      expectReplyIncludes: ['Менеджеру каналов', 'готов'],
      assertState: (state) => {
        if (state.photos_intent !== 'later') return 'photos_intent != later';
        if (state.status !== 'ready_for_channel_manager') return `status=${state.status}`;
        if ((state.readiness?.readiness_percent ?? 0) !== 100) {
          return `readiness=${state.readiness?.readiness_percent ?? 0}`;
        }
        return null;
      },
    },
  ];
}

function flattenMarkupLabels(markup: OwnerOnboardingResult['replyMarkup']): string[] {
  return (
    markup?.inline_keyboard?.flat().map((button) => text(button.text, 120)).filter(Boolean) ?? []
  );
}

function describeExpected(step: WizardAcceptanceStepInput): string {
  const parts: string[] = [];
  if (step.expectReplyIncludes?.length) parts.push(`reply∋${step.expectReplyIncludes.join(' + ')}`);
  if (step.expectReplyMatches?.length) parts.push(`reply~/${step.expectReplyMatches.map((item) => item.source).join('/')}/`);
  if (step.expectEditInPlace === true) parts.push('editInPlace=true');
  if (step.expectEditInPlace === false) parts.push('editInPlace=false');
  if (step.expectReadinessAtLeast != null) parts.push(`readiness>=${step.expectReadinessAtLeast}`);
  if (step.expectNextField) parts.push(`next=${step.expectNextField}`);
  if (step.expectMarkupIncludes?.length) parts.push(`markup∋${step.expectMarkupIncludes.join(' + ')}`);
  if (step.assertState) parts.push('state assertion');
  return parts.join('; ') || 'ok response';
}

function evaluateStep(step: WizardAcceptanceStepInput, result: OwnerOnboardingResult): string[] {
  const failures: string[] = [];
  const reply = text(result.replyText, 1200);

  if (!reply && !step.expectEditInPlace) failures.push('empty reply');
  for (const fragment of step.expectReplyIncludes ?? []) {
    if (!reply.toLocaleLowerCase('ru-RU').includes(fragment.toLocaleLowerCase('ru-RU'))) {
      failures.push(`reply missing "${fragment}"`);
    }
  }
  for (const pattern of step.expectReplyMatches ?? []) {
    if (!pattern.test(reply)) failures.push(`reply does not match /${pattern.source}/`);
  }
  if (step.expectEditInPlace === true && !result.editInPlace) failures.push('expected editInPlace=true');
  if (step.expectEditInPlace === false && result.editInPlace) failures.push('expected editInPlace=false');
  if (step.expectReadinessAtLeast != null) {
    const readiness = result.state.readiness?.readiness_percent ?? 0;
    if (readiness < step.expectReadinessAtLeast) {
      failures.push(`readiness ${readiness} < ${step.expectReadinessAtLeast}`);
    }
  }
  if (step.expectNextField && result.state.missing[0] !== step.expectNextField) {
    failures.push(`next field ${result.state.missing[0] ?? 'none'} != ${step.expectNextField}`);
  }
  for (const label of step.expectMarkupIncludes ?? []) {
    const labels = flattenMarkupLabels(result.replyMarkup);
    if (!labels.some((item) => item.includes(label))) {
      failures.push(`markup missing "${label}"`);
    }
  }
  if (step.assertState) {
    const stateFailure = step.assertState(result.state, result);
    if (stateFailure) failures.push(stateFailure);
  }
  return failures;
}

export async function runWizardAcceptanceStep(params: {
  chatId: number;
  text?: string;
  callbackData?: string;
  step?: WizardAcceptanceStepInput;
  updateId?: number;
}): Promise<WizardAcceptanceStepResult> {
  assertWizardAcceptanceChatAllowed(params.chatId);
  const envelope = buildWizardAcceptanceEnvelope({
    chatId: params.chatId,
    text: params.text,
    callbackData: params.callbackData,
    updateId: params.updateId,
  });
  const result = await processTelegramOwnerOnboarding({
    envelope,
    chatId: params.chatId,
    senderIdentity: 'lead',
  });
  const step = params.step;
  const failures = step ? evaluateStep(step, result) : [];
  const input = params.callbackData || params.text || '';
  return {
    id: step?.id ?? 'custom',
    label: step?.label ?? 'custom',
    input,
    expected: step ? describeExpected(step) : 'handled',
    actual: [
      text(result.replyText, 180),
      result.editInPlace ? 'editInPlace' : 'newMessage',
      `readiness=${result.state.readiness?.readiness_percent ?? 'n/a'}`,
      `status=${result.state.status}`,
    ].join(' | '),
    pass: failures.length === 0,
    failures,
    readinessPercent: result.state.readiness?.readiness_percent ?? null,
    status: result.state.status,
    editInPlace: Boolean(result.editInPlace),
    crmContactId: result.crmContactId,
  };
}

async function findAcceptanceCrmContact(chatId: number): Promise<CrmContact | null> {
  const contacts = await listCrmContacts();
  const username = WIZARD_ACCEPTANCE_USERNAME.toLowerCase();
  const contactKey = `tg:${chatId}`;
  return (
    contacts.find((item) => item.telegramUsername?.toLowerCase() === username) ??
    contacts.find((item) => item.phone === contactKey || item.note.includes(`owner_id=${chatId}`)) ??
    null
  );
}

async function listAcceptanceCrmEvents(contactId: string): Promise<CrmEventRow[]> {
  try {
    const { data, error } = await supabase
      .from('crm_events')
      .select('id,contact_id,event_type,message_text,metadata,created_at')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(30);
    if (error || !data) return [];
    return data as CrmEventRow[];
  } catch {
    return [];
  }
}

export async function validateWizardAcceptanceCrm(params: {
  chatId: number;
  crmContactId?: string;
}): Promise<WizardAcceptanceCrmValidation> {
  const failures: string[] = [];
  const contact =
    (params.crmContactId
      ? (await listCrmContacts()).find((item) => item.id === params.crmContactId) ?? null
      : null) ?? (await findAcceptanceCrmContact(params.chatId));

  if (!contact) {
    return {
      ok: false,
      failures: ['crm contact not found for acceptance chat'],
      contactId: null,
      queueColumn: null,
      readinessPercent: null,
      onboardingStatus: null,
      channels: [],
      rules: [],
      nextBestStep: null,
      activityEvents: [],
      readinessEvents: [],
      channelEvents: [],
    };
  }

  const events = await listAcceptanceCrmEvents(contact.id);
  const messagesByContact = await listCrmEventsByContactIds([contact.id], 8);
  const activities = buildCardActivities(contact, events);
  const queueItem = buildQueueItem(contact, messagesByContact[contact.id] ?? [], activities);

  const channels = contact.onboarding?.channels ?? [];
  const rules = contact.onboarding?.rules ?? [];
  const requiredChannels = ['Суточно', 'Авито', 'Собственный сайт', 'Telegram', 'TravelLine', 'МирКвартир'];
  const requiredRules = ['Не курить', 'Без вечеринок', 'Тихие часы после 22:00'];

  if (queueItem.column !== 'ready_for_cm') failures.push(`queue column=${queueItem.column}`);
  if ((queueItem.readinessPercent ?? 0) !== 100) failures.push(`crm readiness=${queueItem.readinessPercent}`);
  if (!queueItem.readyForChannelManager) failures.push('readyForChannelManager=false');
  if (!queueItem.nextBestStep?.toLocaleLowerCase('ru-RU').includes('менеджер каналов')) {
    failures.push('next step does not mention channel manager');
  }
  for (const channel of requiredChannels) {
    if (!channels.includes(channel)) failures.push(`crm channels missing ${channel}`);
  }
  for (const rule of requiredRules) {
    if (!rules.includes(rule)) failures.push(`crm rules missing ${rule}`);
  }

  const activityEvents = activities.map((item) => item.label);
  const readinessEvents = events
    .filter((row) => row.event_type.includes('readiness'))
    .map((row) => text(row.message_text, 120));
  const channelEvents = events
    .filter((row) => row.event_type === 'onboarding_channel_saved' || row.event_type === 'object_readiness_requested_channels')
    .map((row) => text(row.message_text, 120));

  if (!readinessEvents.length) failures.push('no readiness events in activity feed');
  if (!channelEvents.length && !activityEvents.some((item) => item.toLocaleLowerCase('ru-RU').includes('канал'))) {
    failures.push('no channel-related activity feed events');
  }

  return {
    ok: failures.length === 0,
    failures,
    contactId: contact.id,
    queueColumn: queueItem.column,
    readinessPercent: queueItem.readinessPercent,
    onboardingStatus: queueItem.onboardingStatus,
    channels,
    rules,
    nextBestStep: queueItem.nextBestStep,
    activityEvents,
    readinessEvents,
    channelEvents,
  };
}

export function formatWizardAcceptanceTable(rows: WizardAcceptanceStepResult[]): string {
  const headers = ['Step', 'Input / callback', 'Expected', 'Actual', 'Pass / Fail'];
  const tableRows = rows.map((row) => [
    row.label,
    row.input,
    row.expected,
    row.actual,
    row.pass ? 'PASS' : `FAIL (${row.failures.join('; ')})`,
  ]);
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...tableRows.map((row) => String(row[index] ?? '').length)),
  );
  const formatLine = (cells: string[]) =>
    cells.map((cell, index) => String(cell).padEnd(widths[index])).join(' | ');
  return [formatLine(headers), formatLine(widths.map((width) => '-'.repeat(width))), ...tableRows.map(formatLine)].join('\n');
}

export async function runWizardAcceptanceScenario(params: {
  chatId: number;
  resetTestState?: boolean;
  preserveObjectIds?: string[];
}): Promise<WizardAcceptanceRunResult> {
  assertWizardAcceptanceChatAllowed(params.chatId);
  const beforeObjects =
    params.preserveObjectIds?.length ? snapshotWizardAcceptanceObjects(params.chatId) : null;

  if (params.resetTestState !== false) {
    resetWizardAcceptanceState(params.chatId);
  }

  const steps: WizardAcceptanceStepResult[] = [];
  let lastCrmContactId: string | undefined;
  let updateCounter = 0;
  for (const step of buildWizardV2AcceptanceSteps()) {
    const result = await runWizardAcceptanceStep({
      chatId: params.chatId,
      text: step.text,
      callbackData: step.callbackData,
      step,
      updateId: 990_000 + params.chatId + updateCounter++,
    });
    steps.push(result);
    lastCrmContactId = result.crmContactId ?? lastCrmContactId;
    if (!result.pass) break;
  }

  const finalEnvelope = buildWizardAcceptanceEnvelope({ chatId: params.chatId, text: '' });
  const finalResult = await processTelegramOwnerOnboarding({
    envelope: finalEnvelope,
    chatId: params.chatId,
    senderIdentity: 'lead',
  });
  const finalState = finalResult.state;
  const objectId = getActiveOwnerObjectId(params.chatId, 'telegram');
  const channels = finalState.channels_list ?? labelsFromChannelIds(finalState.channels_draft ?? []);
  const rules = finalState.rules ?? labelsFromRuleIds(finalState.rules_draft ?? []);
  const crm = await validateWizardAcceptanceCrm({
    chatId: params.chatId,
    crmContactId: lastCrmContactId,
  });

  const afterObjects =
    beforeObjects && params.preserveObjectIds?.length
      ? snapshotWizardAcceptanceObjects(params.chatId)
      : null;
  const objectsSafety =
    beforeObjects && afterObjects && params.preserveObjectIds?.length
      ? verifyPreservedObjectsUnchanged(beforeObjects, afterObjects, params.preserveObjectIds)
      : { ok: true, failures: [] as string[], preservedObjectIds: params.preserveObjectIds ?? [] };

  const allPass = steps.every((item) => item.pass) && crm.ok && objectsSafety.ok;
  return {
    ok: allPass,
    chatId: params.chatId,
    steps,
    finalState,
    objectId,
    readinessPercent: finalState.readiness?.readiness_percent ?? null,
    channels,
    rules,
    crm,
    objectsSafety: {
      ok: objectsSafety.ok,
      failures: objectsSafety.failures,
      preservedObjectIds: params.preserveObjectIds ?? [],
    },
  };
}

export function summarizeWizardAcceptanceRun(run: WizardAcceptanceRunResult): Record<string, unknown> {
  return {
    ok: run.ok,
    chatId: run.chatId,
    readinessPercent: run.readinessPercent,
    objectId: run.objectId,
    status: run.finalState?.status ?? null,
    checkoutTime: run.finalState?.checkout_time ?? null,
    photosIntent: run.finalState?.photos_intent ?? null,
    channels: run.channels,
    rules: run.rules,
    crmStatus: run.crm.onboardingStatus,
    crmQueueColumn: run.crm.queueColumn,
    activityFeed: run.crm.activityEvents,
    failedSteps: run.steps.filter((item) => !item.pass).map((item) => item.id),
    crmFailures: run.crm.failures,
    objectsSafetyFailures: run.objectsSafety.failures,
  };
}
