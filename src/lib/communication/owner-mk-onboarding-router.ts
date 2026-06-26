import type { TelegramInlineKeyboardMarkup } from './communication-identity-routing';
import {
  CHANNEL_MANAGER_REGISTRY,
  channelManagerDisplayName,
  getChannelManagerById,
} from '@/lib/channel-manager/registry';
import {
  CHANNEL_OPTIONS,
  buildWizardStepKeyboard,
  customChannelLabelFromId,
  isCustomChannelId,
  labelsFromChannelIds,
  validateOwnerContactInput,
  OWNER_CONTACT_SERVICE_BOT_REJECT_RU,
  type OwnerOnboardingWizardField,
} from './telegram-owner-onboarding-wizard';
import type { OwnerOnboardingState, OwnerOnboardingStatus } from './telegram-owner-onboarding';
import { isIdentitySelectionText } from './owner-onboarding-smart-parser';
import type {
  ChannelManagerConnectionMethod,
  ChannelManagerConnectionState,
  ChannelManagerConnectionStatus,
  ChannelManagerObjectInManager,
  ChannelManagerRoute,
  MkAutomationConnectionStatus,
  MkResponsibleRole,
} from '@/lib/channel-manager-connection/types';

export const MK_CALLBACK_PREFIX = 'obmk:';
export const MK_STATUS_CALLBACK_DATA = `${MK_CALLBACK_PREFIX}status`;

export type OwnerMkPhase =
  | 'not_started'
  | 'ask_has_cm'
  | 'ask_cm_vendor'
  | 'ask_property_in_cm'
  | 'minimal_collect'
  | 'explain_cm'
  | 'ask_responsible'
  | 'await_responsible_contact'
  | 'wizard'
  | 'completed';

export type OwnerMkRoute = 'has_cm' | 'no_cm' | 'unknown_cm' | 'unknown_help';

export type OwnerMkPropertyInCm = 'yes' | 'no' | 'unknown';

export type OwnerMkFollowupKind =
  | 'channel_manager_existing_check'
  | 'channel_manager_selection_needed'
  | 'channel_manager_explain_and_select';

export type MkMinimalField = 'object_name' | 'location' | 'owner_contact' | 'target_placement';

export type MkResponsibleSelectableRole = Exclude<MkResponsibleRole, 'owner' | 'unknown' | 'asi_help'>;

export type OwnerMkOnboardingResult = {
  handled: boolean;
  replyText: string;
  replyMarkup?: TelegramInlineKeyboardMarkup;
  editInPlace?: boolean;
  editInPlaceMode?: 'markup' | 'text';
  state: OwnerOnboardingState;
  status: OwnerOnboardingStatus;
  missing: OwnerOnboardingWizardField[];
};

function text(value: unknown, max = 600): string {
  return String(value ?? '').trim().slice(0, max);
}

function callbackData(action: string, value?: string): string {
  const raw = value ? `${MK_CALLBACK_PREFIX}${action}:${value}` : `${MK_CALLBACK_PREFIX}${action}`;
  return raw.slice(0, 64);
}

function selectedManagerLabel(state: OwnerOnboardingState): string | null {
  const label = channelManagerDisplayName(state.selected_channel_manager);
  if (label) return label;
  const raw = text(state.selected_channel_manager, 80);
  return raw || null;
}

function selectedManagerMethod(state: OwnerOnboardingState): ChannelManagerConnectionMethod | null {
  if (state.selected_channel_manager === 'bnovo') return 'bnovo';
  if (state.selected_channel_manager === 'realtycalendar') return 'realtycalendar';
  if (state.mk_route === 'no_cm') return 'none_yet';
  if (state.selected_channel_manager) return 'other';
  return null;
}

export function mkResponsibleRoleLabel(role: MkResponsibleRole | null | undefined): string {
  switch (role) {
    case 'owner':
      return 'владелец';
    case 'manager':
      return 'управляющий';
    case 'administrator':
      return 'администратор';
    case 'staff':
      return 'другой сотрудник';
    case 'unknown':
      return 'ответственный ещё не выбран';
    case 'asi_help':
      return 'нужна помощь ASI';
    default:
      return 'ответственный ещё не выбран';
  }
}

function hasMkResponsibleDecision(state: OwnerOnboardingState): boolean {
  return Boolean(state.mk_responsible_role);
}

export function shouldAskOwnerMkResponsible(state: OwnerOnboardingState): boolean {
  return Boolean(state.mk_route) && !hasMkResponsibleDecision(state);
}

function ownerContactFromState(state: OwnerOnboardingState): string {
  return text(state.owner_contact, 160) || 'текущий контакт владельца';
}

function extractResponsibleName(contactText: string): string | undefined {
  const withoutHandles = contactText
    .replace(/@\w+/g, ' ')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, ' ')
    .replace(/\b(?:telegram|телеграм|тел|phone|контакт)\b/gi, ' ')
    .replace(/[,:;|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!withoutHandles) return undefined;
  const words = withoutHandles.split(' ').filter((word) => /[А-Яа-яA-Za-zЁё]/.test(word));
  return words.slice(0, 3).join(' ') || undefined;
}

export function buildOwnerMkResponsiblePrompt(): string {
  return 'Кто со стороны объекта будет отвечать за подключение менеджера каналов?';
}

function responsibleKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: 'Я сам', callback_data: callbackData('resp', 'owner') }],
      [{ text: 'Управляющий', callback_data: callbackData('resp', 'manager') }],
      [{ text: 'Администратор', callback_data: callbackData('resp', 'administrator') }],
      [{ text: 'Другой сотрудник', callback_data: callbackData('resp', 'staff') }],
      [{ text: 'Пока не знаю', callback_data: callbackData('resp', 'unknown') }],
      [{ text: 'Нужна помощь ASI', callback_data: callbackData('resp', 'asi_help') }],
    ],
  };
}

export function buildOwnerMkResponsibleQuestionResult(state: OwnerOnboardingState): OwnerMkOnboardingResult {
  state.mk_phase = 'ask_responsible';
  state.status = 'missing_required_data';
  state.mk_connection_state = buildOwnerMkConnectionState(state);
  return {
    handled: true,
    replyText: buildOwnerMkResponsiblePrompt(),
    replyMarkup: responsibleKeyboard(),
    state,
    status: 'missing_required_data',
    missing: state.missing,
  };
}

function automationRoute(state: OwnerOnboardingState): ChannelManagerRoute {
  if (state.mk_route === 'has_cm') return 'has_manager';
  if (state.mk_route === 'unknown_cm' || state.mk_route === 'unknown_help') return 'unknown';
  return 'no_manager';
}

function automationObjectInManager(state: OwnerOnboardingState): ChannelManagerObjectInManager {
  if (state.property_in_channel_manager === 'yes') return 'yes';
  if (state.property_in_channel_manager === 'no') return 'no';
  return 'unknown';
}

export function resolveOwnerMkConnectionStatus(state: OwnerOnboardingState): MkAutomationConnectionStatus {
  if (state.mk_responsible_role === 'unknown') return 'waiting_for_owner';
  if (state.mk_responsible_role === 'asi_help') return 'ready_for_operator_review';
  if (state.mk_route === 'has_cm' && state.property_in_channel_manager === 'yes') return 'needs_manager_check';
  if (
    state.mk_route === 'has_cm' &&
    (state.property_in_channel_manager === 'no' || state.property_in_channel_manager === 'unknown')
  ) {
    return 'needs_object_preparation';
  }
  return 'needs_manager_selection';
}

export function buildOwnerMkNextOperatorAction(state: OwnerOnboardingState): string {
  if (state.mk_responsible_role === 'unknown') {
    return 'Уточнить у владельца, кто будет отвечать за подключение менеджера каналов';
  }
  if (state.mk_responsible_role === 'asi_help') {
    return 'Взять подключение менеджера каналов в ручной разбор ASI';
  }
  if (state.mk_responsible_role) {
    return 'Связаться с ответственным и провести его по подключению менеджера каналов';
  }
  if (state.mk_route === 'has_cm' && state.property_in_channel_manager === 'yes') {
    return 'Проверить возможность подключения ASI к существующему менеджеру каналов';
  }
  if (
    state.mk_route === 'has_cm' &&
    (state.property_in_channel_manager === 'no' || state.property_in_channel_manager === 'unknown')
  ) {
    return 'Подготовить объект для добавления в менеджер каналов';
  }
  if (state.mk_route === 'unknown_cm' || state.mk_route === 'unknown_help') {
    return 'Объяснить владельцу менеджер каналов и предложить подходящий путь';
  }
  return 'Подобрать подходящий менеджер каналов и подготовить подключение';
}

export function buildOwnerMkStatusMessage(state: OwnerOnboardingState): string {
  if (state.mk_responsible_role === 'unknown') {
    return 'Данные объекта собраны. Следующий шаг — выбрать ответственного за подключение менеджера каналов.';
  }
  if (state.mk_responsible_role === 'asi_help') {
    return [
      'Данные объекта собраны. Следующий шаг — ручной разбор подключения менеджера каналов оператором ASI.',
      'Если понадобится доступ к кабинету менеджера каналов, оператор подскажет безопасный способ передачи.',
    ].join(' ');
  }
  if (state.mk_responsible_role) {
    const contact = text(state.mk_responsible_contact, 160);
    const responsible = [mkResponsibleRoleLabel(state.mk_responsible_role), contact].filter(Boolean).join(', ');
    return [
      'Данные объекта собраны. Следующий шаг — подключить менеджер каналов.',
      `Ответственный: ${responsible}.`,
      'Если понадобится доступ или подтверждение, оператор напишет ответственному.',
    ].join('\n');
  }
  return [
    'Данные объекта собраны.',
    'Следующий шаг — выбрать ответственного за подключение менеджера каналов.',
  ].join(' ');
}

function legacyStatusForAutomation(status: MkAutomationConnectionStatus): ChannelManagerConnectionStatus {
  switch (status) {
    case 'needs_manager_check':
    case 'needs_access_confirmation':
      return 'verifying_data';
    case 'needs_object_preparation':
    case 'ready_for_operator_review':
      return 'prepared';
    case 'waiting_for_owner':
      return 'waiting_access';
    case 'done':
      return 'connected';
    case 'needs_manager_selection':
    default:
      return 'primary_setup_needed';
  }
}

export function buildOwnerMkConnectionState(
  state: OwnerOnboardingState,
  ids?: { contactId?: string | null; objectId?: string | null },
): ChannelManagerConnectionState {
  const connectionStatus = resolveOwnerMkConnectionStatus(state);
  const selectedChannelManager = selectedManagerLabel(state);
  const method = selectedManagerMethod(state);
  const nextOwnerMessage = buildOwnerMkStatusMessage(state);
  return {
    objectId: ids?.objectId ?? null,
    contactId: ids?.contactId ?? null,
    method,
    customManagerName: method === 'other' ? selectedChannelManager : null,
    accessSituation: null,
    status: legacyStatusForAutomation(connectionStatus),
    nextStepRu: nextOwnerMessage,
    selectedChannelManager,
    channelManagerRoute: automationRoute(state),
    objectInChannelManager: automationObjectInManager(state),
    targetPlacementChannels: state.target_placement_channels ?? state.channels_list ?? [],
    connectionStatus,
    mkResponsibleRole: state.mk_responsible_role ?? null,
    mkResponsibleContact: state.mk_responsible_contact ?? null,
    mkResponsibleName: state.mk_responsible_name ?? null,
    nextOperatorAction: buildOwnerMkNextOperatorAction(state),
    nextOwnerMessage,
    updatedAt: new Date().toISOString(),
  };
}

export function isMkOnboardingCallback(data: unknown): boolean {
  return text(data, 64).startsWith(MK_CALLBACK_PREFIX);
}

export function parseMkCallback(data: unknown): { action: string; value?: string } | null {
  const raw = text(data, 64);
  if (!raw.startsWith(MK_CALLBACK_PREFIX)) return null;
  const parts = raw.slice(MK_CALLBACK_PREFIX.length).split(':');
  const action = parts[0] ?? '';
  if (!action) return null;
  return { action, value: parts.slice(1).join(':') || undefined };
}

export function resolveOwnerMkFollowupKind(state: OwnerOnboardingState): OwnerMkFollowupKind {
  if (state.mk_route === 'has_cm') return 'channel_manager_existing_check';
  if (state.mk_route === 'no_cm') return 'channel_manager_selection_needed';
  if (state.mk_route === 'unknown_cm' || state.mk_route === 'unknown_help') {
    return 'channel_manager_explain_and_select';
  }
  return 'channel_manager_selection_needed';
}

export function shouldStartMkRouting(state: OwnerOnboardingState, isConnectIntent: boolean): boolean {
  if (!isConnectIntent) return false;
  if (state.mk_phase === 'wizard' || state.mk_phase === 'completed') return false;
  if (state.mk_phase && state.mk_phase !== 'not_started') return false;
  const hasProgress = Boolean(state.city || state.address || state.property_name || state.object_type);
  if (hasProgress) return false;
  if (state.status === 'ready_for_channel_manager' || state.status === 'channel_manager_started') return false;
  return true;
}

export function isMkRoutingActive(state: OwnerOnboardingState): boolean {
  return Boolean(
    state.mk_phase &&
      state.mk_phase !== 'not_started' &&
      state.mk_phase !== 'wizard' &&
      state.mk_phase !== 'completed',
  );
}

export function missingMkMinimalFields(state: OwnerOnboardingState): MkMinimalField[] {
  const missing: MkMinimalField[] = [];
  if (!text(state.property_name)) missing.push('object_name');
  if (!text(state.city) && !text(state.address)) missing.push('location');
  if (!text(state.owner_contact)) missing.push('owner_contact');
  if (
    !state.target_placement_skipped &&
    !(state.target_placement_channels?.length ?? 0) &&
    !(state.channels_list?.length ?? 0)
  ) {
    missing.push('target_placement');
  }
  return missing;
}

function hasCmKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: 'Да, уже есть', callback_data: callbackData('has', 'yes') }],
      [{ text: 'Нет, пока нет', callback_data: callbackData('has', 'no') }],
      [{ text: 'Не знаю, что это', callback_data: callbackData('has', 'unknown') }],
    ],
  };
}

function cmVendorKeyboard(): TelegramInlineKeyboardMarkup {
  const selectable = CHANNEL_MANAGER_REGISTRY.filter((entry) => entry.id !== 'unknown_later');
  const rows: TelegramInlineKeyboardMarkup['inline_keyboard'] = [];
  for (let i = 0; i < selectable.length; i += 2) {
    rows.push(
      selectable.slice(i, i + 2).map((entry) => ({
        text: entry.displayName,
        callback_data: callbackData('cm', entry.id),
      })),
    );
  }
  rows.push([{ text: 'Не помню / уточню позже', callback_data: callbackData('cm', 'unknown_later') }]);
  return { inline_keyboard: rows };
}

function propertyInCmKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: 'Да, объект уже есть', callback_data: callbackData('prop', 'yes') }],
      [{ text: 'Нет, нужно добавить', callback_data: callbackData('prop', 'no') }],
      [{ text: 'Не знаю', callback_data: callbackData('prop', 'unknown') }],
    ],
  };
}

function explainChoiceKeyboard(): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: 'У меня уже есть такая система', callback_data: callbackData('explain', 'has') }],
      [{ text: 'Нет, нужна помощь с выбором', callback_data: callbackData('explain', 'help') }],
      [{ text: 'Подготовить объект с нуля', callback_data: callbackData('explain', 'scratch') }],
    ],
  };
}

function multiSelectButtonLabel(selected: boolean, label: string): string {
  return selected ? `✅ ${label}` : label;
}

function channelLabelById(id: string): string | undefined {
  const fixed = CHANNEL_OPTIONS.find((item) => item.id === id)?.label;
  if (fixed) return fixed;
  if (isCustomChannelId(id)) {
    const label = id.slice(2).trim();
    return label || undefined;
  }
  return customChannelLabelFromId(id);
}

function buildMkPlacementKeyboard(selectedIds: string[]): TelegramInlineKeyboardMarkup {
  const rows: TelegramInlineKeyboardMarkup['inline_keyboard'] = [];
  const customIds = selectedIds.filter(isCustomChannelId);

  for (const item of CHANNEL_OPTIONS) {
    rows.push([
      {
        text: multiSelectButtonLabel(selectedIds.includes(item.id), item.label),
        callback_data: callbackData('ch_t', item.id),
      },
    ]);
  }

  for (const customId of customIds) {
    const label = channelLabelById(customId);
    if (!label) continue;
    rows.push([
      {
        text: multiSelectButtonLabel(true, label),
        callback_data: callbackData('ch_t', customId),
      },
    ]);
  }

  rows.push([{ text: 'Готово', callback_data: callbackData('ch_done') }]);
  rows.push([{ text: 'Не знаю / пропустить', callback_data: callbackData('placement', 'skip') }]);
  return { inline_keyboard: rows };
}

function mkMinimalPrompt(field: MkMinimalField): string {
  switch (field) {
    case 'object_name':
      return 'Как называется объект? Напишите короткое название.';
    case 'location':
      return 'Укажите город или адрес объекта — можно район или ориентир.';
    case 'owner_contact':
      return 'Укажите контакт для связи: телефон или Telegram.';
    case 'target_placement':
      return [
        'Если знаете, отметьте площадки, которые уже подключены через ваш менеджер каналов.',
        'Можно выбрать несколько или нажать «Не знаю / пропустить».',
      ].join('\n');
    default:
      return '';
  }
}

function syncTargetPlacementChannels(state: OwnerOnboardingState): void {
  const labels = state.target_placement_channels ?? state.channels_list ?? [];
  state.target_placement_channels = labels;
  state.channels_list = labels;
  state.channels = labels.length ? labels.join(', ') : undefined;
}

function beginWizardFromMk(state: OwnerOnboardingState, intro?: string): OwnerMkOnboardingResult {
  state.mk_phase = 'wizard';
  state.mk_collection_mode = 'full';
  state.mk_connection_state = buildOwnerMkConnectionState(state);
  const next: OwnerOnboardingWizardField = 'city';
  return {
    handled: true,
    replyText: [intro, 'Поняла. Укажите, пожалуйста, город объекта.'].filter(Boolean).join('\n\n'),
    replyMarkup: buildWizardStepKeyboard(next, {
      channels_draft: state.channels_draft ?? [],
      rules_draft: state.rules_draft ?? [],
    }),
    state,
    status: 'onboarding_started',
    missing: [next],
  };
}

function finalizeMinimalFlow(state: OwnerOnboardingState): OwnerMkOnboardingResult {
  syncTargetPlacementChannels(state);
  if (shouldAskOwnerMkResponsible(state)) {
    return buildOwnerMkResponsibleQuestionResult(state);
  }
  state.mk_phase = 'completed';
  state.mk_collection_mode = 'minimal';
  state.status = 'ready_for_channel_manager';
  state.missing = [];
  state.mk_connection_state = buildOwnerMkConnectionState(state);
  return {
    handled: true,
    replyText: [
      'Поняла. Мы проверим возможность подключения ASI к вашему менеджеру каналов.',
      'Если понадобится доступ или подтверждение, оператор напишет вам. Пока ничего дополнительно делать не нужно.',
    ].join('\n'),
    state,
    status: 'ready_for_channel_manager',
    missing: [],
  };
}

function applyMinimalTextStep(state: OwnerOnboardingState, messageText: string): boolean {
  const field = missingMkMinimalFields(state)[0];
  if (!field) return false;

  if (field === 'object_name') {
    const name = text(messageText, 120);
    if (name.length < 2) return false;
    state.property_name = name;
    return true;
  }

  if (field === 'location') {
    const value = text(messageText, 400);
    if (value.length < 2) return false;
    if (/(ул\.?|улиц|просп|д\.|дом|\d{1,4})/i.test(value)) {
      state.address = value;
    } else {
      state.city = value;
    }
    return true;
  }

  if (field === 'owner_contact') {
    const validation = validateOwnerContactInput(messageText);
    if (!validation.ok) return false;
    state.owner_contact = validation.contact;
    return true;
  }

  return false;
}

function handleMkCallback(state: OwnerOnboardingState, data: string): OwnerMkOnboardingResult | null {
  const parsed = parseMkCallback(data);
  if (!parsed) return null;

  switch (parsed.action) {
    case 'status':
      state.mk_connection_state = buildOwnerMkConnectionState(state);
      return {
        handled: true,
        replyText: buildOwnerMkStatusMessage(state),
        state,
        status: state.status,
        missing: state.missing,
      };

    case 'has':
      if (parsed.value === 'yes') {
        state.mk_route = 'has_cm';
        state.mk_phase = 'ask_cm_vendor';
        state.mk_connection_state = buildOwnerMkConnectionState(state);
        return {
          handled: true,
          replyText: 'Какой менеджер каналов вы используете?',
          replyMarkup: cmVendorKeyboard(),
          state,
          status: state.status,
          missing: state.missing,
        };
      }
      if (parsed.value === 'no') {
        state.mk_route = 'no_cm';
        state.mk_connection_state = buildOwnerMkConnectionState(state);
        return beginWizardFromMk(state);
      }
      if (parsed.value === 'unknown') {
        state.mk_route = 'unknown_cm';
        state.mk_phase = 'explain_cm';
        state.mk_connection_state = buildOwnerMkConnectionState(state);
        return {
          handled: true,
          replyText: [
            'Менеджер каналов — это система, через которую объект передаётся на площадки бронирования: Авито, Островок, Суточно и другие.',
            'ASI подключается к менеджеру каналов, а площадки идут через него.',
          ].join('\n'),
          replyMarkup: explainChoiceKeyboard(),
          state,
          status: state.status,
          missing: state.missing,
        };
      }
      return null;

    case 'cm': {
      const cmId = parsed.value ?? '';
      if (!getChannelManagerById(cmId)) return null;
      state.selected_channel_manager = cmId;
      state.mk_route = 'has_cm';
      state.mk_phase = 'ask_property_in_cm';
      state.mk_connection_state = buildOwnerMkConnectionState(state);
      return {
        handled: true,
        replyText: 'Объект уже добавлен в этом менеджере каналов?',
        replyMarkup: propertyInCmKeyboard(),
        state,
        status: state.status,
        missing: state.missing,
      };
    }

    case 'prop':
      if (parsed.value === 'yes') {
        state.property_in_channel_manager = 'yes';
        state.mk_collection_mode = 'minimal';
        state.mk_phase = 'minimal_collect';
        state.mk_connection_state = buildOwnerMkConnectionState(state);
        return {
          handled: true,
          replyText: mkMinimalPrompt('object_name'),
          state,
          status: 'missing_required_data',
          missing: state.missing,
        };
      }
      if (parsed.value === 'no' || parsed.value === 'unknown') {
        state.property_in_channel_manager = parsed.value === 'no' ? 'no' : 'unknown';
        state.mk_connection_state = buildOwnerMkConnectionState(state);
        return beginWizardFromMk(
          state,
          'Тогда подготовим данные объекта, чтобы его можно было добавить в менеджер каналов.',
        );
      }
      return null;

    case 'resp':
      if (parsed.value === 'owner') {
        state.mk_responsible_role = 'owner';
        state.mk_responsible_contact = ownerContactFromState(state);
        state.mk_responsible_name = undefined;
        state.mk_phase = 'completed';
        state.status = 'ready_for_channel_manager';
        state.missing = [];
        state.mk_connection_state = buildOwnerMkConnectionState(state);
        return {
          handled: true,
          replyText: 'Хорошо. Я буду считать вас ответственным за подключение менеджера каналов.',
          state,
          status: 'ready_for_channel_manager',
          missing: [],
        };
      }
      if (parsed.value === 'manager' || parsed.value === 'administrator' || parsed.value === 'staff') {
        state.mk_responsible_role = parsed.value;
        state.mk_phase = 'await_responsible_contact';
        state.status = 'missing_required_data';
        state.mk_connection_state = buildOwnerMkConnectionState(state);
        return {
          handled: true,
          replyText: 'Укажите Telegram или телефон человека, который будет заниматься подключением.',
          state,
          status: 'missing_required_data',
          missing: state.missing,
        };
      }
      if (parsed.value === 'unknown') {
        state.mk_responsible_role = 'unknown';
        state.mk_responsible_contact = undefined;
        state.mk_responsible_name = undefined;
        state.mk_phase = 'completed';
        state.status = 'ready_for_channel_manager';
        state.mk_connection_state = buildOwnerMkConnectionState(state);
        return {
          handled: true,
          replyText: 'Хорошо. Когда определитесь, напишите, кто будет отвечать за подключение. Пока я сохраню объект и отмечу, что ответственный ещё не выбран.',
          state,
          status: 'ready_for_channel_manager',
          missing: [],
        };
      }
      if (parsed.value === 'asi_help') {
        state.mk_responsible_role = 'asi_help';
        state.mk_responsible_contact = undefined;
        state.mk_responsible_name = undefined;
        state.mk_phase = 'completed';
        state.status = 'ready_for_channel_manager';
        state.mk_connection_state = buildOwnerMkConnectionState(state);
        return {
          handled: true,
          replyText: 'Поняла. Передам задачу оператору ASI. Если понадобится доступ к кабинету менеджера каналов, оператор подскажет безопасный способ передачи.',
          state,
          status: 'ready_for_channel_manager',
          missing: [],
        };
      }
      return null;

    case 'explain':
      if (parsed.value === 'has') {
        state.mk_route = 'has_cm';
        state.mk_phase = 'ask_cm_vendor';
        state.mk_connection_state = buildOwnerMkConnectionState(state);
        return {
          handled: true,
          replyText: 'Какой менеджер каналов вы используете?',
          replyMarkup: cmVendorKeyboard(),
          state,
          status: state.status,
          missing: state.missing,
        };
      }
      if (parsed.value === 'help') {
        state.mk_route = 'unknown_help';
        state.mk_connection_state = buildOwnerMkConnectionState(state);
        return beginWizardFromMk(state);
      }
      if (parsed.value === 'scratch') {
        state.mk_route = 'no_cm';
        state.mk_connection_state = buildOwnerMkConnectionState(state);
        return beginWizardFromMk(state);
      }
      return null;

    case 'placement':
      if (parsed.value === 'skip') {
        state.target_placement_skipped = true;
        state.mk_connection_state = buildOwnerMkConnectionState(state);
        return finalizeMinimalFlow(state);
      }
      return null;

    case 'ch_t': {
      if (state.mk_phase !== 'minimal_collect') return null;
      const draft = new Set(state.channels_draft ?? []);
      const channelId = parsed.value ?? '';
      if (draft.has(channelId)) draft.delete(channelId);
      else draft.add(channelId);
      state.channels_draft = [...draft];
      return {
        handled: true,
        replyText: mkMinimalPrompt('target_placement'),
        replyMarkup: buildMkPlacementKeyboard(state.channels_draft),
        editInPlace: true,
        editInPlaceMode: 'markup',
        state,
        status: 'missing_required_data',
        missing: state.missing,
      };
    }

    case 'ch_done': {
      if (state.mk_phase !== 'minimal_collect') return null;
      const labels = labelsFromChannelIds(state.channels_draft ?? []);
      if (!labels.length) {
        return {
          handled: true,
          replyText: 'Выберите хотя бы одну площадку или нажмите «Не знаю / пропустить».',
          replyMarkup: buildMkPlacementKeyboard(state.channels_draft ?? []),
          editInPlace: true,
          editInPlaceMode: 'text',
          state,
          status: 'missing_required_data',
          missing: state.missing,
        };
      }
      state.target_placement_channels = labels;
      state.channels_list = labels;
      state.channels = labels.join(', ');
      state.channels_draft = [];
      state.mk_connection_state = buildOwnerMkConnectionState(state);
      return finalizeMinimalFlow(state);
    }

    default:
      return null;
  }
}

export function buildMkReadyOwnerMessage(state: OwnerOnboardingState): string {
  if (state.mk_collection_mode === 'minimal' || state.property_in_channel_manager === 'yes') {
    return [
      'Данные сохранены.',
      'Следующий шаг — проверить подключение ASI к вашему менеджеру каналов.',
      'Если понадобится доступ или подтверждение, оператор напишет вам.',
    ].join(' ');
  }
  if (state.mk_route === 'no_cm') {
    return [
      'Данные объекта собраны.',
      'Следующий шаг — подготовить объект к подключению через менеджер каналов.',
      'После этого выбранные площадки смогут подключаться через него.',
    ].join(' ');
  }
  if (state.mk_route === 'unknown_cm' || state.mk_route === 'unknown_help') {
    return 'Данные сохранены. Мы поможем определить, нужен ли вам менеджер каналов и какой вариант подойдёт.';
  }
  return [
    'Данные объекта собраны.',
    'Следующий шаг — подготовить объект к подключению через менеджер каналов.',
    'После этого выбранные площадки смогут подключаться через него.',
  ].join(' ');
}

export function buildMkNoCmFinalAddon(): string {
  return 'Следующий шаг — подобрать или подключить менеджер каналов. Через него объект сможет передаваться на выбранные площадки.';
}

export function tryHandleOwnerMkOnboarding(params: {
  state: OwnerOnboardingState;
  messageText: string;
  mkCallback?: string;
  isConnectIntent: boolean;
}): OwnerMkOnboardingResult | null {
  const state = params.state;
  const mkCallback = text(params.mkCallback, 64);
  const messageText = text(params.messageText, 600);

  if (mkCallback && isMkOnboardingCallback(mkCallback)) {
    const callbackResult = handleMkCallback(state, mkCallback);
    if (callbackResult) return callbackResult;
  }

  if (shouldStartMkRouting(state, params.isConnectIntent)) {
    state.mk_phase = 'ask_has_cm';
    return {
      handled: true,
      replyText: 'У вас уже есть менеджер каналов?',
      replyMarkup: hasCmKeyboard(),
      state,
      status: 'onboarding_started',
      missing: state.missing,
    };
  }

  if (state.mk_phase === 'minimal_collect') {
    const missingMinimal = missingMkMinimalFields(state);
    if (missingMinimal.length === 0) {
      return finalizeMinimalFlow(state);
    }

    const current = missingMinimal[0];

    if (current === 'target_placement') {
      return {
        handled: true,
        replyText: mkMinimalPrompt('target_placement'),
        replyMarkup: buildMkPlacementKeyboard(state.channels_draft ?? []),
        state,
        status: 'missing_required_data',
        missing: state.missing,
      };
    }

    if (messageText && !isIdentitySelectionText(messageText)) {
      const applied = applyMinimalTextStep(state, messageText);
      const stillMissing = missingMkMinimalFields(state);
      if (stillMissing.length === 0) {
        return finalizeMinimalFlow(state);
      }
      const next = stillMissing[0];
      if (!applied) {
        const validation = validateOwnerContactInput(messageText);
        const reject =
          next === 'owner_contact' && !validation.ok && validation.reason === 'service_bot'
            ? OWNER_CONTACT_SERVICE_BOT_REJECT_RU
            : mkMinimalPrompt(next);
        return {
          handled: true,
          replyText: reject,
          replyMarkup:
            next === 'target_placement' ? buildMkPlacementKeyboard(state.channels_draft ?? []) : undefined,
          state,
          status: 'missing_required_data',
          missing: state.missing,
        };
      }
      if (next === 'target_placement') {
        return {
          handled: true,
          replyText: mkMinimalPrompt('target_placement'),
          replyMarkup: buildMkPlacementKeyboard(state.channels_draft ?? []),
          state,
          status: 'missing_required_data',
          missing: state.missing,
        };
      }
      return {
        handled: true,
        replyText: mkMinimalPrompt(next),
        state,
        status: 'missing_required_data',
        missing: state.missing,
      };
    }

    return {
      handled: true,
      replyText: mkMinimalPrompt(current),
      replyMarkup: undefined,
      state,
      status: 'missing_required_data',
      missing: state.missing,
    };
  }

  if (state.mk_phase === 'await_responsible_contact') {
    if (messageText && !isIdentitySelectionText(messageText)) {
      state.mk_responsible_contact = messageText;
      state.mk_responsible_name = extractResponsibleName(messageText);
      state.mk_phase = 'completed';
      state.status = 'ready_for_channel_manager';
      state.missing = [];
      state.mk_connection_state = buildOwnerMkConnectionState(state);
      return {
        handled: true,
        replyText: 'Поняла. Я подготовлю для него короткую инструкцию по подключению менеджера каналов.',
        state,
        status: 'ready_for_channel_manager',
        missing: [],
      };
    }
    return {
      handled: true,
      replyText: 'Укажите Telegram или телефон человека, который будет заниматься подключением.',
      state,
      status: 'missing_required_data',
      missing: state.missing,
    };
  }

  if (isMkRoutingActive(state)) {
    if (state.mk_phase === 'ask_has_cm') {
      return {
        handled: true,
        replyText: 'У вас уже есть менеджер каналов?',
        replyMarkup: hasCmKeyboard(),
        state,
        status: state.status,
        missing: state.missing,
      };
    }
    if (state.mk_phase === 'ask_cm_vendor') {
      return {
        handled: true,
        replyText: 'Какой менеджер каналов вы используете?',
        replyMarkup: cmVendorKeyboard(),
        state,
        status: state.status,
        missing: state.missing,
      };
    }
    if (state.mk_phase === 'ask_property_in_cm') {
      const cmLabel = channelManagerDisplayName(state.selected_channel_manager);
      return {
        handled: true,
        replyText: [
          cmLabel ? `Вы выбрали: ${cmLabel}.` : null,
          'Объект уже добавлен в этом менеджере каналов?',
        ]
          .filter(Boolean)
          .join('\n'),
        replyMarkup: propertyInCmKeyboard(),
        state,
        status: state.status,
        missing: state.missing,
      };
    }
    if (state.mk_phase === 'explain_cm') {
      return {
        handled: true,
        replyText: [
          'Менеджер каналов — это система, через которую объект передаётся на площадки бронирования: Авито, Островок, Суточно и другие.',
          'ASI подключается к менеджеру каналов, а площадки идут через него.',
        ].join('\n'),
        replyMarkup: explainChoiceKeyboard(),
        state,
        status: state.status,
        missing: state.missing,
      };
    }
    if (state.mk_phase === 'ask_responsible') {
      return buildOwnerMkResponsibleQuestionResult(state);
    }
  }

  return null;
}

export function placementChannelsPromptRu(): string {
  return [
    'На каких площадках вы хотите размещаться через менеджер каналов?',
    'Мы не подключаем площадки напрямую. Сначала объект готовится для менеджера каналов, а уже он передаёт данные на площадки.',
    'Можно отметить несколько, затем нажмите «Готово».',
  ].join('\n');
}
