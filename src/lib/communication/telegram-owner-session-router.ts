import { supabase } from '@/lib/supabase';
import type { TelegramInlineKeyboardMarkup } from './communication-identity-routing';
import { isIdentitySelectionText } from './owner-onboarding-smart-parser';
import type { InboundMessageEnvelope, CommunicationChannel } from './types';
import type { SenderIdentity } from './communication-identity-routing';
import {
  computeObjectReadiness,
  readinessInputFromOnboardingState,
} from '@/lib/object-readiness/engine';
import type { OwnerOnboardingResult, OwnerOnboardingState } from './telegram-owner-onboarding';
import {
  createOwnerObject,
  listOwnerObjectRecords,
  migrateLegacyOwnerSessionIfNeeded,
  objectTitleFromState,
  ownerHasExistingObjects,
  readOwnerObjectState,
  switchActiveOwnerObject,
} from './telegram-owner-object-session';
import { buildWizardStepKeyboard, buildWizardStepPrompt, WIZARD_FIELD_ORDER } from './telegram-owner-onboarding-wizard';

export const SESSION_ROUTER_CALLBACK_PREFIX = 'obsr:';

const MY_OBJECTS_COMMAND = /^(мои\s+объекты|список\s+объектов|покажи\s+объекты)$/i;

export function isSessionRouterCallback(data: unknown): boolean {
  return String(data ?? '').trim().startsWith(SESSION_ROUTER_CALLBACK_PREFIX);
}

export function isNewObjectConnectionIntent(messageText: string): boolean {
  return isIdentitySelectionText(messageText);
}

export function isMyObjectsCommand(messageText: string): boolean {
  return MY_OBJECTS_COMMAND.test(String(messageText ?? '').trim());
}

function text(value: unknown, max = 600): string {
  return String(value ?? '').trim().slice(0, max);
}

function activeObjectTitle(chatId: number, channel: CommunicationChannel): string {
  const records = listOwnerObjectRecords(chatId, channel);
  const active = records.find((item) => item.isActiveSession) ?? records[0];
  return active?.title ?? 'Новый объект';
}

function choicePromptMarkup(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: 'Продолжить', callback_data: `${SESSION_ROUTER_CALLBACK_PREFIX}continue` }],
      [{ text: 'Создать новый', callback_data: `${SESSION_ROUTER_CALLBACK_PREFIX}new` }],
      [{ text: 'Мои объекты', callback_data: `${SESSION_ROUTER_CALLBACK_PREFIX}list` }],
    ],
  };
}

function objectListMarkup(chatId: number, channel: CommunicationChannel): TelegramInlineKeyboardMarkup {
  const records = listOwnerObjectRecords(chatId, channel);
  const rows = records.flatMap((item, index) => {
    const label = `${index + 1}. ${item.title}`.slice(0, 40);
    return [
      [
        { text: `Продолжить: ${label}`, callback_data: `${SESSION_ROUTER_CALLBACK_PREFIX}switch:${item.objectId}` },
        { text: `Открыть: ${label}`, callback_data: `${SESSION_ROUTER_CALLBACK_PREFIX}view:${item.objectId}` },
      ],
      [{ text: `Активный объект: ${label}`, callback_data: `${SESSION_ROUTER_CALLBACK_PREFIX}active:${item.objectId}` }],
    ];
  });
  return { inline_keyboard: rows };
}

function buildObjectsListText(chatId: number, channel: CommunicationChannel): string {
  const records = listOwnerObjectRecords(chatId, channel);
  const lines = records.map((item, index) => {
    const activeMark = item.isActiveSession ? '\nАктивная сессия' : '';
    return `${index + 1}. ${item.title}\nГотовность: ${item.readinessPercent}%${activeMark}`;
  });
  return ['Ваши объекты:', '', ...lines].join('\n');
}

function summarizeObjectState(state: OwnerOnboardingState): string {
  const readiness = computeObjectReadiness(
    readinessInputFromOnboardingState({
      ...state,
      channels: state.channels_list ?? state.channels,
      rules: state.rules ?? state.house_rules,
      status: state.status,
    }),
  );
  const title = objectTitleFromState(state);
  const missing = state.missing.length
    ? `Не хватает: ${state.missing.join(', ')}`
    : 'Минимальные данные собраны.';
  return [
    `Объект: ${title}`,
    `Готовность: ${readiness.readiness_percent}%`,
    missing,
    state.status === 'ready_for_channel_manager' ? 'Объект готов к Менеджеру каналов.' : '',
  ]
    .filter(Boolean)
    .join('\n');
}

async function emitOwnerObjectEvent(params: {
  contactId?: string;
  eventType: 'owner_object_created' | 'owner_object_switched' | 'owner_object_continued';
  messageText: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  if (!params.contactId) return;
  try {
    await supabase.from('crm_events').insert({
      contact_id: params.contactId,
      event_type: params.eventType,
      message_text: params.messageText,
      metadata: params.metadata,
      created_at: new Date().toISOString(),
    });
  } catch {
    // non-fatal
  }
}

function baseResult(state: OwnerOnboardingState): OwnerOnboardingResult {
  return {
    handled: true,
    replyText: '',
    status: state.status,
    missing: state.missing,
    state,
  };
}

export function shouldPromptObjectChoice(params: {
  chatId: number;
  channel: CommunicationChannel;
  messageText: string;
  wizardCallback?: string;
  sessionRouterCallback?: string;
}): boolean {
  if (params.wizardCallback || params.sessionRouterCallback) return false;
  if (!isNewObjectConnectionIntent(params.messageText) && !isMyObjectsCommand(params.messageText)) return false;
  if (!ownerHasExistingObjects(params.chatId, params.channel)) return false;

  const active = readOwnerObjectState(params.chatId, params.channel);
  const hasProgress =
    Boolean(active.address?.trim()) ||
    active.status !== 'onboarding_started' ||
    (active.missing.length > 0 && active.missing[0] !== 'address');

  if (isMyObjectsCommand(params.messageText)) return true;
  return hasProgress;
}

export async function tryHandleOwnerSessionRouter(params: {
  envelope: InboundMessageEnvelope;
  chatId: number;
  channel: CommunicationChannel;
  senderIdentity: SenderIdentity;
  crmContactId?: string;
  sessionRouterCallback?: string;
  wizardCallback?: string;
}): Promise<OwnerOnboardingResult | null> {
  migrateLegacyOwnerSessionIfNeeded(params.chatId, params.channel);

  const callback = text(params.sessionRouterCallback, 64);
  const messageText = params.envelope.messageText ?? '';

  if (callback) {
    if (callback === `${SESSION_ROUTER_CALLBACK_PREFIX}continue`) {
      const state = readOwnerObjectState(params.chatId, params.channel);
      const next = state.missing[0] ?? 'address';
      await emitOwnerObjectEvent({
        contactId: params.crmContactId,
        eventType: 'owner_object_continued',
        messageText: `Продолжение объекта ${objectTitleFromState(state)}`,
        metadata: { object_id: objectTitleFromState(state) },
      });
      return {
        ...baseResult(state),
        replyText: [
          `Продолжаем объект: ${objectTitleFromState(state)}`,
          buildWizardStepPrompt(next),
        ].join('\n\n'),
        replyMarkup: buildWizardStepKeyboard(next, {
          channels_draft: state.channels_draft ?? [],
          rules_draft: state.rules_draft ?? [],
        }),
      };
    }

    if (callback === `${SESSION_ROUTER_CALLBACK_PREFIX}new`) {
      const { objectId, state } = createOwnerObject(params.chatId, params.channel);
      await emitOwnerObjectEvent({
        contactId: params.crmContactId,
        eventType: 'owner_object_created',
        messageText: `Создан новый объект ${objectId}`,
        metadata: { object_id: objectId },
      });
      return {
        ...baseResult(state),
        replyText: [
          `Создала новый объект ${objectId}.`,
          'Поняла. Помогу подключить объект к ASI.',
          buildWizardStepPrompt('address'),
        ].join('\n\n'),
        replyMarkup: buildWizardStepKeyboard('address'),
      };
    }

    if (callback === `${SESSION_ROUTER_CALLBACK_PREFIX}edit`) {
      const state = readOwnerObjectState(params.chatId, params.channel);
      state.status = 'missing_required_data';
      state.wizard_redo_from = 'city';
      state.missing = [...WIZARD_FIELD_ORDER];
      return {
        ...baseResult(state),
        replyText: [
          'Давайте обновим данные объекта.',
          'Пройдём шаги заново — новые ответы заменят прежние значения.',
          buildWizardStepPrompt('city'),
        ].join('\n\n'),
        replyMarkup: buildWizardStepKeyboard('city', {
          channels_draft: state.channels_draft ?? [],
          rules_draft: state.rules_draft ?? [],
        }),
      };
    }

    if (callback === `${SESSION_ROUTER_CALLBACK_PREFIX}list` || isMyObjectsCommand(messageText)) {
      return {
        ...baseResult(readOwnerObjectState(params.chatId, params.channel)),
        replyText: buildObjectsListText(params.chatId, params.channel),
        replyMarkup: objectListMarkup(params.chatId, params.channel),
      };
    }

    const switchMatch = callback.match(/^obsr:switch:(OBJ-\d+)$/);
    if (switchMatch?.[1]) {
      const objectId = switchMatch[1];
      const state = switchActiveOwnerObject(params.chatId, params.channel, objectId);
      if (!state) return null;
      await emitOwnerObjectEvent({
        contactId: params.crmContactId,
        eventType: 'owner_object_switched',
        messageText: `Переключение на объект ${objectTitleFromState(state)}`,
        metadata: { object_id: objectId },
      });
      const next = state.missing[0] ?? 'address';
      return {
        ...baseResult(state),
        replyText: [
          `Переключилась на объект: ${objectTitleFromState(state)}`,
          buildWizardStepPrompt(next),
        ].join('\n\n'),
        replyMarkup: buildWizardStepKeyboard(next, {
          channels_draft: state.channels_draft ?? [],
          rules_draft: state.rules_draft ?? [],
        }),
      };
    }

    const viewMatch = callback.match(/^obsr:view:(OBJ-\d+)$/);
    if (viewMatch?.[1]) {
      const state = readOwnerObjectState(params.chatId, params.channel, viewMatch[1]);
      return {
        ...baseResult(state),
        replyText: summarizeObjectState(state),
        replyMarkup: objectListMarkup(params.chatId, params.channel),
      };
    }

    const activeMatch = callback.match(/^obsr:active:(OBJ-\d+)$/);
    if (activeMatch?.[1]) {
      const objectId = activeMatch[1];
      const state = switchActiveOwnerObject(params.chatId, params.channel, objectId);
      if (!state) return null;
      await emitOwnerObjectEvent({
        contactId: params.crmContactId,
        eventType: 'owner_object_switched',
        messageText: `Активный объект: ${objectTitleFromState(state)}`,
        metadata: { object_id: objectId, active_session: true },
      });
      return {
        ...baseResult(state),
        replyText: `Активный объект: ${objectTitleFromState(state)}`,
        replyMarkup: objectListMarkup(params.chatId, params.channel),
      };
    }
  }

  if (
    shouldPromptObjectChoice({
      chatId: params.chatId,
      channel: params.channel,
      messageText,
      wizardCallback: params.wizardCallback,
      sessionRouterCallback: params.sessionRouterCallback,
    }) &&
    isNewObjectConnectionIntent(messageText)
  ) {
    const title = activeObjectTitle(params.chatId, params.channel);
    return {
      ...baseResult(readOwnerObjectState(params.chatId, params.channel)),
      replyText: [
        'У вас уже есть объект в работе:',
        '',
        title,
        '',
        'Что сделать?',
      ].join('\n'),
      replyMarkup: choicePromptMarkup(),
    };
  }

  if (isMyObjectsCommand(messageText)) {
    return {
      ...baseResult(readOwnerObjectState(params.chatId, params.channel)),
      replyText: buildObjectsListText(params.chatId, params.channel),
      replyMarkup: objectListMarkup(params.chatId, params.channel),
    };
  }

  return null;
}
