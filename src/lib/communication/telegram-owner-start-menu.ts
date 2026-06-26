import type { TelegramInlineKeyboardMarkup } from './communication-identity-routing';
import { isIdentitySelectionText } from './owner-onboarding-smart-parser';
import {
  buildOwnerMkStatusMessage,
  buildMkHasCmQuestionResult,
} from './owner-mk-onboarding-router';
import type { OwnerOnboardingResult, OwnerOnboardingState } from './telegram-owner-onboarding';
import {
  computeObjectReadiness,
  readinessInputFromOnboardingState,
} from '@/lib/object-readiness/engine';
import {
  createOwnerObject,
  listOwnerObjectRecords,
  migrateLegacyOwnerSessionIfNeeded,
  objectTitleFromState,
  ownerHasExistingObjects,
  persistOwnerObjectState,
  readOwnerObjectState,
} from './telegram-owner-object-session';
import {
  buildWizardStepKeyboard,
  buildWizardStepPrompt,
  missingWizardFields,
} from './telegram-owner-onboarding-wizard';
import { telegramSupportBotUrl } from '@/config/telegramBots';
import type { CommunicationChannel } from './types';
import type { InboundMessageEnvelope } from './types';
import type { SenderIdentity } from './communication-identity-routing';

export const START_MENU_CALLBACK_PREFIX = 'obmenu:';

const RESET_INTENT = /^(начать\s+заново|сбросить)$/i;
const NEW_OBJECT_INTENT = /^(новый\s+объект|подключить\s+новый\s+объект)$/i;
const GREETING_INTENT =
  /^(здравствуйте|привет|добрый\s+день|доброе\s+утро|добрый\s+вечер|добрый\s+вечер|hello|hi)$/i;

function text(value: unknown, max = 600): string {
  return String(value ?? '').trim().slice(0, max);
}

function normalizeRu(value: string): string {
  return text(value, 2000)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isStartMenuCallback(data: unknown): boolean {
  return text(data, 64).startsWith(START_MENU_CALLBACK_PREFIX);
}

export function isOwnerResetCommand(messageText: string): boolean {
  const raw = text(messageText, 80);
  return /^\/reset(?:@\w+)?$/i.test(raw);
}

export function isOwnerStartCommand(messageText: string): boolean {
  const raw = text(messageText, 80);
  return /^\/start(?:@\w+)?$/i.test(raw);
}

export function isOwnerResetIntentText(messageText: string): boolean {
  return RESET_INTENT.test(normalizeRu(messageText));
}

export function isOwnerNewObjectIntentText(messageText: string): boolean {
  return NEW_OBJECT_INTENT.test(normalizeRu(messageText));
}

export function isOwnerGreetingText(messageText: string): boolean {
  return GREETING_INTENT.test(normalizeRu(messageText));
}

export function isOwnerOnboardingSessionCompleted(state: OwnerOnboardingState): boolean {
  return state.status === 'ready_for_channel_manager' || state.status === 'channel_manager_started';
}

export function isOwnerOnboardingSessionIncomplete(state: OwnerOnboardingState): boolean {
  if (isOwnerOnboardingSessionCompleted(state)) return false;
  if (
    state.mk_phase &&
    state.mk_phase !== 'not_started' &&
    state.mk_phase !== 'completed' &&
    state.mk_phase !== 'wizard'
  ) {
    return true;
  }
  if (state.mk_phase === 'wizard') return true;
  const hasProgress =
    Boolean(state.city?.trim()) ||
    Boolean(state.address?.trim()) ||
    Boolean(state.property_name?.trim()) ||
    Boolean(state.object_type?.trim()) ||
    state.status !== 'onboarding_started' ||
    (state.missing.length > 0 && state.missing[0] !== 'city');
  return hasProgress;
}

function completedMainMenuMarkup(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: 'Подключить новый объект', callback_data: `${START_MENU_CALLBACK_PREFIX}new` }],
      [{ text: 'Проверить статус подключения', callback_data: `${START_MENU_CALLBACK_PREFIX}status` }],
      [{ text: 'Изменить данные объекта', callback_data: `${START_MENU_CALLBACK_PREFIX}edit` }],
      [{ text: 'Связаться с поддержкой', url: telegramSupportBotUrl }],
    ],
  };
}

function incompleteSessionMenuMarkup(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: 'Продолжить', callback_data: `${START_MENU_CALLBACK_PREFIX}continue` }],
      [{ text: 'Начать заново', callback_data: `${START_MENU_CALLBACK_PREFIX}restart` }],
    ],
  };
}

function sameAddressChoiceMarkup(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: 'Да, тот же адрес', callback_data: `${START_MENU_CALLBACK_PREFIX}new:same` }],
      [{ text: 'Нет, другой адрес', callback_data: `${START_MENU_CALLBACK_PREFIX}new:other` }],
      [{ text: 'Уточнить корпус/квартиру', callback_data: `${START_MENU_CALLBACK_PREFIX}new:details` }],
    ],
  };
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

function recomputeMissing(state: OwnerOnboardingState): void {
  state.missing = missingWizardFields({
    city: state.city,
    address: state.address,
    object_type: state.object_type,
    object_name: state.property_name,
    owner_contact: state.owner_contact,
    checkin_time: state.checkin_time,
    checkout_time: state.checkout_time,
    channels: state.channels_list ?? (state.channels ? state.channels.split(',').map((item) => item.trim()) : []),
    rules: state.rules ?? (state.house_rules ? state.house_rules.split(',').map((item) => item.trim()) : []),
    wifi_name: state.wifi_name,
    wifi_password: state.wifi_password,
    wifi_skipped: state.wifi_skipped,
    photos: state.photos,
    photos_intent: state.photos_intent,
    photos_count: state.photos_count,
  });
}

function previousObjectWithAddress(
  chatId: number,
  channel: CommunicationChannel,
  activeObjectId?: string,
): { objectId: string; state: OwnerOnboardingState } | null {
  const records = listOwnerObjectRecords(chatId, channel);
  for (const item of [...records].reverse()) {
    if (activeObjectId && item.objectId === activeObjectId) continue;
    const state = readOwnerObjectState(chatId, channel, item.objectId);
    if (state.address?.trim()) return { objectId: item.objectId, state };
  }
  return null;
}

function prepareFreshObjectForMkFirst(chatId: number, channel: CommunicationChannel): {
  objectId: string;
  state: OwnerOnboardingState;
  previous: { objectId: string; state: OwnerOnboardingState } | null;
} {
  const { objectId, state } = createOwnerObject(chatId, channel);
  const previous = previousObjectWithAddress(chatId, channel, objectId);
  if (previous?.state.city && !state.city) {
    state.city = previous.state.city;
    recomputeMissing(state);
  }
  return { objectId, state, previous };
}

function mkFirstResetReply(state: OwnerOnboardingState, intro?: string): OwnerOnboardingResult {
  const mk = buildMkHasCmQuestionResult(state);
  const prefix = intro ?? 'Начнём заново.';
  return {
    ...baseResult(mk.state),
    replyText: `${prefix} ${mk.replyText}`,
    replyMarkup: mk.replyMarkup,
    status: mk.status,
    missing: mk.missing,
    state: mk.state,
    skipAutomationSync: true,
    skipCrmUpsert: mk.state.mk_phase === 'ask_has_cm',
  };
}

function buildCompletedMainMenuResult(state: OwnerOnboardingState): OwnerOnboardingResult {
  return {
    ...baseResult(state),
    replyText: 'Здравствуйте. Чем помочь?',
    replyMarkup: completedMainMenuMarkup(),
    skipAutomationSync: true,
    skipCrmUpsert: true,
  };
}

function buildIncompleteSessionMenuResult(state: OwnerOnboardingState): OwnerOnboardingResult {
  return {
    ...baseResult(state),
    replyText: 'У вас есть незавершённое подключение. Продолжить или начать заново?',
    replyMarkup: incompleteSessionMenuMarkup(),
    skipAutomationSync: true,
    skipCrmUpsert: true,
  };
}

function findObjectForStatusCheck(chatId: number, channel: CommunicationChannel): {
  objectId: string;
  state: OwnerOnboardingState;
} | null {
  const records = listOwnerObjectRecords(chatId, channel);
  const completed = records.filter(
    (item) => item.status === 'ready_for_channel_manager' || item.status === 'channel_manager_started',
  );
  const pick =
    completed.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ??
    records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (!pick) return null;
  return { objectId: pick.objectId, state: readOwnerObjectState(chatId, channel, pick.objectId) };
}

function buildStatusSummary(state: OwnerOnboardingState): string {
  const readiness = computeObjectReadiness(
    readinessInputFromOnboardingState({
      ...state,
      channels: state.channels_list ?? state.channels,
      rules: state.rules ?? state.house_rules,
      status: state.status,
    }),
  );
  const title = objectTitleFromState(state);
  const statusLine = buildOwnerMkStatusMessage(state);
  const missing = state.missing.length
    ? `Не хватает: ${state.missing.join(', ')}`
    : 'Минимальные данные собраны.';
  return [
    `Объект: ${title}`,
    `Готовность: ${readiness.readiness_percent}%`,
    missing,
    statusLine,
  ]
    .filter(Boolean)
    .join('\n');
}

function startNewObjectMkFirst(params: {
  chatId: number;
  channel: CommunicationChannel;
  intro?: string;
}): OwnerOnboardingResult {
  const { objectId, state, previous } = prepareFreshObjectForMkFirst(params.chatId, params.channel);
  if (previous?.state.address) {
    persistOwnerObjectState(params.chatId, params.channel, objectId, state);
    return {
      ...baseResult(state),
      replyText: [
        params.intro ?? 'Подключаем новый объект.',
        `Использовать тот же адрес, что у предыдущего объекта: ${previous.state.address}?`,
      ].join('\n\n'),
      replyMarkup: sameAddressChoiceMarkup(),
      skipAutomationSync: true,
      skipCrmUpsert: true,
    };
  }
  const mk = mkFirstResetReply(state, params.intro ?? 'Подключаем новый объект.');
  persistOwnerObjectState(params.chatId, params.channel, objectId, mk.state);
  return mk;
}

export type OwnerStartMenuResult = OwnerOnboardingResult & {
  skipAutomationSync?: boolean;
  skipCrmUpsert?: boolean;
};

export async function tryHandleOwnerStartMenu(params: {
  envelope: InboundMessageEnvelope;
  chatId: number;
  channel: CommunicationChannel;
  senderIdentity: SenderIdentity;
  startMenuCallback?: string;
}): Promise<OwnerStartMenuResult | null> {
  migrateLegacyOwnerSessionIfNeeded(params.chatId, params.channel);

  const messageText = text(params.envelope.messageText, 600);
  const callback = text(params.startMenuCallback, 64);
  const activeState = readOwnerObjectState(params.chatId, params.channel);

  if (callback) {
    if (callback === `${START_MENU_CALLBACK_PREFIX}continue`) {
      const next = activeState.missing[0] ?? 'city';
      return {
        ...baseResult(activeState),
        replyText: [
          `Продолжаем подключение: ${objectTitleFromState(activeState)}`,
          buildWizardStepPrompt(next),
        ].join('\n\n'),
        replyMarkup: buildWizardStepKeyboard(next, {
          channels_draft: activeState.channels_draft ?? [],
          rules_draft: activeState.rules_draft ?? [],
        }),
        skipAutomationSync: true,
      };
    }

    if (callback === `${START_MENU_CALLBACK_PREFIX}restart`) {
      const { objectId, state } = createOwnerObject(params.chatId, params.channel);
      const reset = mkFirstResetReply(state);
      persistOwnerObjectState(params.chatId, params.channel, objectId, reset.state);
      return reset;
    }

    if (callback === `${START_MENU_CALLBACK_PREFIX}new`) {
      return startNewObjectMkFirst({
        chatId: params.chatId,
        channel: params.channel,
        intro: 'Подключаем новый объект.',
      });
    }

    if (callback === `${START_MENU_CALLBACK_PREFIX}new:same`) {
      const { objectId, state, previous } = prepareFreshObjectForMkFirst(params.chatId, params.channel);
      if (previous?.state.address) {
        state.city = previous.state.city ?? state.city;
        state.address = previous.state.address;
        state.awaiting_address_details = false;
        recomputeMissing(state);
      }
      const mk = mkFirstResetReply(state, 'Хорошо, адрес сохраню для нового объекта.');
      persistOwnerObjectState(params.chatId, params.channel, objectId, mk.state);
      return mk;
    }

    if (callback === `${START_MENU_CALLBACK_PREFIX}new:other`) {
      const { objectId, state } = prepareFreshObjectForMkFirst(params.chatId, params.channel);
      state.address = undefined;
      state.addressDetails = undefined;
      state.awaiting_address_details = false;
      recomputeMissing(state);
      const mk = mkFirstResetReply(state);
      persistOwnerObjectState(params.chatId, params.channel, objectId, mk.state);
      return mk;
    }

    if (callback === `${START_MENU_CALLBACK_PREFIX}new:details`) {
      const { objectId, state, previous } = prepareFreshObjectForMkFirst(params.chatId, params.channel);
      if (previous?.state.address) {
        state.city = previous.state.city ?? state.city;
        state.address = previous.state.address;
      }
      state.awaiting_address_details = true;
      recomputeMissing(state);
      persistOwnerObjectState(params.chatId, params.channel, objectId, state);
      return {
        ...baseResult(state),
        replyText: 'Напишите уточнение к адресу: корпус, подъезд, квартира или апартаменты.',
        skipAutomationSync: true,
        skipCrmUpsert: true,
      };
    }

    if (callback === `${START_MENU_CALLBACK_PREFIX}status`) {
      const target = findObjectForStatusCheck(params.chatId, params.channel);
      if (!target) {
        return {
          ...baseResult(activeState),
          replyText: 'Пока нет сохранённых объектов. Можно начать подключение с кнопки «Подключить новый объект».',
          replyMarkup: completedMainMenuMarkup(),
          skipAutomationSync: true,
          skipCrmUpsert: true,
        };
      }
      return {
        ...baseResult(target.state),
        replyText: buildStatusSummary(target.state),
        replyMarkup: completedMainMenuMarkup(),
        skipAutomationSync: true,
        skipCrmUpsert: true,
      };
    }

    if (callback === `${START_MENU_CALLBACK_PREFIX}edit`) {
      activeState.status = 'missing_required_data';
      activeState.wizard_redo_from = 'city';
      activeState.missing = missingWizardFields({
        city: activeState.city,
        address: activeState.address,
        object_type: activeState.object_type,
        object_name: activeState.property_name,
        owner_contact: activeState.owner_contact,
        checkin_time: activeState.checkin_time,
        checkout_time: activeState.checkout_time,
        channels: activeState.channels_list ?? [],
        rules: activeState.rules ?? [],
        wifi_name: activeState.wifi_name,
        wifi_password: activeState.wifi_password,
        wifi_skipped: activeState.wifi_skipped,
        photos: activeState.photos,
        photos_intent: activeState.photos_intent,
        photos_count: activeState.photos_count,
      });
      return {
        ...baseResult(activeState),
        replyText: [
          'Давайте обновим данные объекта.',
          'Пройдём шаги заново — новые ответы заменят прежние значения.',
          buildWizardStepPrompt('city'),
        ].join('\n\n'),
        replyMarkup: buildWizardStepKeyboard('city', {
          channels_draft: activeState.channels_draft ?? [],
          rules_draft: activeState.rules_draft ?? [],
        }),
      };
    }
  }

  if (isOwnerResetCommand(messageText) || isOwnerResetIntentText(messageText)) {
    const { objectId, state } = createOwnerObject(params.chatId, params.channel);
    const reset = mkFirstResetReply(state);
    persistOwnerObjectState(params.chatId, params.channel, objectId, reset.state);
    return reset;
  }

  if (isOwnerStartCommand(messageText)) {
    if (isOwnerOnboardingSessionIncomplete(activeState)) {
      return buildIncompleteSessionMenuResult(activeState);
    }
    if (isOwnerOnboardingSessionCompleted(activeState) || ownerHasExistingObjects(params.chatId, params.channel)) {
      return buildCompletedMainMenuResult(activeState);
    }
    const { objectId, state } = createOwnerObject(params.chatId, params.channel);
    const mk = mkFirstResetReply(state, 'Здравствуйте.');
    persistOwnerObjectState(params.chatId, params.channel, objectId, mk.state);
    return mk;
  }

  if (isOwnerNewObjectIntentText(messageText)) {
    return startNewObjectMkFirst({
      chatId: params.chatId,
      channel: params.channel,
    });
  }

  if (
    isIdentitySelectionText(messageText) &&
    isOwnerOnboardingSessionCompleted(activeState) &&
    ownerHasExistingObjects(params.chatId, params.channel)
  ) {
    const { objectId, state } = createOwnerObject(params.chatId, params.channel);
    const mk = mkFirstResetReply(state);
    persistOwnerObjectState(params.chatId, params.channel, objectId, mk.state);
    return mk;
  }

  if (isOwnerGreetingText(messageText) && isOwnerOnboardingSessionCompleted(activeState)) {
    return buildCompletedMainMenuResult(activeState);
  }

  return null;
}
