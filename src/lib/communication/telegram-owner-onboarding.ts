import { supabase } from '@/lib/supabase';
import {
  loadAutonomousSession,
} from './conversation-session-store';
import {
  detectsExplicitOperatorRequest,
  extractFactsDeterministic,
  extractOnboardingFactsSmart,
  isIdentitySelectionText,
  type OwnerOnboardingField,
  type PhotosIntent,
  type SmartParseDecision,
} from './owner-onboarding-smart-parser';
import type { InboundMessageEnvelope, CommunicationChannel } from './types';
import type { SenderIdentity, TelegramInlineKeyboardMarkup } from './communication-identity-routing';
import {
  computeObjectReadiness,
  readinessInputFromOnboardingState,
  REQUIRED_FIELD_LABELS_RU,
  type ObjectReadinessResult,
} from '@/lib/object-readiness/engine';
import { emitObjectReadinessEvents, emitOnboardingChannelSavedEvents } from '@/lib/object-readiness/crm-events';
import {
  buildWizardChecklist,
  buildWizardProgressBlock,
  buildWizardStepKeyboard,
  buildWizardStepPrompt,
  CUSTOM_TIME_INPUT_PROMPT_RU,
  CUSTOM_CHANNEL_INPUT_PROMPT_RU,
  fieldSavedAckRu,
  isWizardCallbackData,
  labelsFromChannelIds,
  labelsFromRuleIds,
  missingWizardFields,
  parseCustomChannelsInput,
  parseCustomTimeInput,
  parseWifiInput,
  parseWizardCallback,
  resolveChannelDraftIds,
  wizardCompletedCount,
  type OwnerOnboardingWizardField,
  WIZARD_FIELD_ORDER,
} from './telegram-owner-onboarding-wizard';
import {
  ensureOwnerObjectsRegistry,
  getActiveOwnerObjectId,
  listOwnerObjectRecords,
  persistOwnerObjectState,
  readOwnerObjectState,
  readOwnerObjectStateIfExists,
} from './telegram-owner-object-session';
import { isSessionRouterCallback, tryHandleOwnerSessionRouter } from './telegram-owner-session-router';

export type OwnerOnboardingStatus =
  | 'onboarding_started'
  | 'missing_required_data'
  | 'ready_for_channel_manager'
  | 'channel_manager_started'
  | 'needs_operator';

export type { OwnerOnboardingField, OwnerOnboardingWizardField };

export type OwnerOnboardingState = Record<OwnerOnboardingField, string | undefined> & {
  city?: string;
  photos_intent?: PhotosIntent;
  clarification_attempts: number;
  status: OwnerOnboardingStatus;
  missing: OwnerOnboardingWizardField[];
  lastMessage: string;
  channelManagerHref: string;
  lastClarificationQuestion?: string;
  readiness?: ObjectReadinessResult;
  wizard_mode?: 'v2' | 'legacy';
  object_type?: string;
  checkin_time?: string;
  checkout_time?: string;
  rules?: string[];
  wifi_name?: string;
  wifi_password?: string;
  wifi_skipped?: boolean;
  photos_count?: number;
  channels_list?: string[];
  awaiting_custom?: 'checkin_time' | 'checkout_time' | 'channels';
  channels_draft?: string[];
  rules_draft?: string[];
  last_saved_field?: OwnerOnboardingWizardField;
};

export type OwnerOnboardingEditInPlaceMode = 'markup' | 'text';

export type OwnerOnboardingResult = {
  handled: boolean;
  replyText: string;
  replyMarkup?: TelegramInlineKeyboardMarkup;
  /** When true, update the callback message in place instead of sending a new one. */
  editInPlace?: boolean;
  editInPlaceMode?: OwnerOnboardingEditInPlaceMode;
  status: OwnerOnboardingStatus;
  missing: OwnerOnboardingWizardField[];
  crmContactId?: string;
  state: OwnerOnboardingState;
};

const LEGACY_FIELD_LABELS: Record<OwnerOnboardingField, string> = {
  address: 'адрес объекта',
  property_name: 'название или тип объекта',
  house_rules: 'правила проживания',
  wifi: 'Wi-Fi',
  checkin_checkout: 'время заезда и выезда',
  photos: 'фото объекта',
  channels: 'каналы бронирования',
};

const CHANNEL_MANAGER_HREF = '/dashboard/channel-connections?source=telegram_onboarding';
const CHANNEL_MANAGER_URL = 'https://asi-global.ru/dashboard/channel-connections?source=telegram_onboarding';
const SESSION_PREFIX = 'owner_onboarding_';
const NOTE_HEADER = 'Онбординг ASI';
const OWNER_OBJECTS_HEADER = 'Объекты владельца';

function text(value: unknown, max = 600): string {
  return String(value ?? '').trim().slice(0, max);
}

function parseJsonArray(raw: unknown): string[] {
  const value = text(raw, 2000);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => text(item, 120)).filter(Boolean) : [];
  } catch {
    return value.split(',').map((item) => item.trim()).filter(Boolean);
  }
}

function telegramUsername(envelope: InboundMessageEnvelope): string {
  return text(
    envelope.metadata?.telegram_username ??
      envelope.metadata?.telegramUsername ??
      (envelope.metadata as any)?.telegram?.username,
    80,
  ).replace(/^@+/, '');
}

function telegramContactKey(envelope: InboundMessageEnvelope): string {
  const username = telegramUsername(envelope);
  if (username) return username;
  const userId = text(envelope.metadata?.telegram_user_id ?? envelope.externalUserId ?? envelope.chatId, 80);
  return userId ? `tg:${userId}` : '';
}

function telegramDisplayName(envelope: InboundMessageEnvelope): string {
  const firstName = text(envelope.metadata?.telegram_first_name ?? (envelope.metadata as any)?.telegram?.first_name, 120);
  const username = telegramUsername(envelope);
  if (firstName) return firstName;
  if (username) return `@${username}`;
  return 'Telegram лид';
}

function readStateFromSession(chatId: number, channel: CommunicationChannel = 'telegram'): OwnerOnboardingState {
  const existing = readOwnerObjectStateIfExists(chatId, channel);
  if (existing) {
    syncLegacyFields(existing);
    existing.missing = missingFields(existing);
    return existing;
  }
  return {
    address: undefined,
    property_name: undefined,
    house_rules: undefined,
    wifi: undefined,
    checkin_checkout: undefined,
    photos: undefined,
    channels: undefined,
    clarification_attempts: 0,
    status: 'onboarding_started',
    missing: missingFields({ wizard_mode: 'v2' }),
    lastMessage: '',
    channelManagerHref: CHANNEL_MANAGER_HREF,
    wizard_mode: 'v2',
    photos_count: 0,
    channels_draft: [],
    rules_draft: [],
    rules: [],
    channels_list: [],
  };
}

function syncLegacyFields(state: OwnerOnboardingState): void {
  if (state.object_type) state.property_name = state.object_type;
  else if (state.property_name && !state.object_type) state.object_type = state.property_name;

  if (state.checkin_time || state.checkout_time) {
    const parts = [];
    if (state.checkin_time) parts.push(`заезд ${state.checkin_time}`);
    if (state.checkout_time) parts.push(`выезд ${state.checkout_time}`);
    state.checkin_checkout = parts.join(', ');
  }

  if (state.rules?.length) state.house_rules = state.rules.join(', ');
  else if (state.house_rules && !state.rules?.length) {
    state.rules = state.house_rules.split(',').map((item) => item.trim()).filter(Boolean);
  }

  if (state.channels_list?.length) state.channels = state.channels_list.join(', ');
  else if (state.channels && !state.channels_list?.length) {
    state.channels_list = state.channels.split(',').map((item) => item.trim()).filter(Boolean);
  }

  if (state.wifi_name || state.wifi_password) {
    state.wifi = [state.wifi_name, state.wifi_password].filter(Boolean).join(' / ');
  } else if (state.wifi_skipped) {
    state.wifi = 'добавлю позже';
  }
}

export function missingFields(state: Partial<OwnerOnboardingState>): OwnerOnboardingWizardField[] {
  if (state.wizard_mode === 'legacy') {
    return (Object.keys(LEGACY_FIELD_LABELS) as OwnerOnboardingField[]).filter((field) => {
      if (field === 'photos' && (state.photos || state.photos_intent === 'later')) return false;
      return !text(state[field]);
    }) as OwnerOnboardingWizardField[];
  }

  return missingWizardFields({
    address: state.address,
    object_type: state.object_type ?? state.property_name,
    checkin_time: state.checkin_time,
    checkout_time: state.checkout_time,
    channels: state.channels_list ?? parseJsonArray(state.channels),
    rules: state.rules ?? parseJsonArray(state.house_rules),
    wifi_name: state.wifi_name,
    wifi_password: state.wifi_password,
    wifi_skipped: state.wifi_skipped,
    photos: state.photos,
    photos_intent: state.photos_intent,
    photos_count: state.photos_count,
  });
}

function detectsChannelManagerStarted(messageText: string): boolean {
  const n = text(messageText)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /начал|перешел|открыл|зашел|запустил/.test(n) && /менеджер каналов|канал/.test(n);
}

function countExtractedFields(
  facts: Partial<Record<OwnerOnboardingField, string>>,
  extras?: { photos_intent?: PhotosIntent; city?: string },
): number {
  let count = Object.keys(facts).length;
  if (extras?.photos_intent === 'later') count += 1;
  if (extras?.city && !facts.address) count += 1;
  return count;
}

function statusForState(params: {
  previousStatus: OwnerOnboardingStatus;
  missing: OwnerOnboardingWizardField[];
  extractedCount: number;
  messageText: string;
  decision: SmartParseDecision;
  clarificationAttempts: number;
}): OwnerOnboardingStatus {
  if (params.previousStatus === 'needs_operator') return 'needs_operator';
  if (detectsChannelManagerStarted(params.messageText)) return 'channel_manager_started';
  if (params.missing.length === 0) return 'ready_for_channel_manager';

  if (params.decision.needs_operator || detectsExplicitOperatorRequest(params.messageText)) {
    return 'needs_operator';
  }

  if (isIdentitySelectionText(params.messageText)) {
    return params.extractedCount > 0 ? 'missing_required_data' : 'onboarding_started';
  }

  if (params.decision.needs_clarification || (params.extractedCount === 0 && params.previousStatus !== 'onboarding_started')) {
    if (params.clarificationAttempts >= 2) return 'needs_operator';
    if (params.extractedCount > 0) return 'missing_required_data';
    return params.previousStatus === 'onboarding_started' ? 'onboarding_started' : 'missing_required_data';
  }

  if (params.extractedCount === 0 && params.clarificationAttempts >= 2 && !isIdentitySelectionText(params.messageText)) {
    return 'needs_operator';
  }

  if (params.extractedCount > 0) return 'missing_required_data';
  return params.previousStatus === 'onboarding_started' ? 'onboarding_started' : 'missing_required_data';
}

function nextClarificationAttempts(params: {
  previousAttempts: number;
  extractedCount: number;
  messageText: string;
  decision: SmartParseDecision;
  previousStatus: OwnerOnboardingStatus;
}): number {
  if (params.extractedCount > 0) return 0;
  if (isIdentitySelectionText(params.messageText)) return params.previousAttempts;
  if (detectsExplicitOperatorRequest(params.messageText) || params.decision.needs_operator) {
    return params.previousAttempts;
  }
  return params.previousAttempts + 1;
}

function missingListRu(missing: OwnerOnboardingWizardField[]): string {
  return missing.map((field) => REQUIRED_FIELD_LABELS_RU[field] ?? field).join(', ');
}

function applySmartFactsToState(
  state: OwnerOnboardingState,
  facts: Partial<Record<OwnerOnboardingField, string>> & { city?: string; photos_intent?: PhotosIntent },
): number {
  let extracted = 0;
  for (const [field, value] of Object.entries(facts) as Array<[OwnerOnboardingField, string | undefined]>) {
    if (!value) continue;
    state[field] = value;
    extracted += 1;
  }
  if (facts.city) {
    state.city = facts.city;
    if (!facts.address) extracted += 1;
  }
  if (facts.photos_intent) {
    state.photos_intent = facts.photos_intent;
    extracted += 1;
  }
  if (facts.property_name) state.object_type = facts.property_name;
  if (facts.house_rules) state.rules = facts.house_rules.split(',').map((item) => item.trim()).filter(Boolean);
  if (facts.channels) state.channels_list = facts.channels.split(',').map((item) => item.trim()).filter(Boolean);
  if (facts.checkin_checkout) {
    const checkinMatch = facts.checkin_checkout.match(/заезд[^,.;]*/i);
    const checkoutMatch = facts.checkin_checkout.match(/выезд[^,.;]*/i);
    if (checkinMatch) state.checkin_time = checkinMatch[0].replace(/^заезд\s*/i, '').trim();
    if (checkoutMatch) state.checkout_time = checkoutMatch[0].replace(/^выезд\s*/i, '').trim();
  }
  if (facts.wifi) {
    const parsed = parseWifiInput(facts.wifi);
    state.wifi_name = parsed.wifi_name;
    state.wifi_password = parsed.wifi_password;
  }
  syncLegacyFields(state);
  return extracted;
}

function legacyMissingFields(missing: OwnerOnboardingWizardField[]): OwnerOnboardingField[] {
  const mapped = missing.map((field): OwnerOnboardingField => {
    if (field === 'object_type') return 'property_name';
    if (field === 'checkin_time' || field === 'checkout_time') return 'checkin_checkout';
    if (field === 'rules') return 'house_rules';
    return field as OwnerOnboardingField;
  });
  return [...new Set(mapped)];
}

function shouldUseLegacyFallback(state: OwnerOnboardingState, extractedCount: number, messageText: string): boolean {
  if (state.wizard_mode === 'legacy') return true;
  if (extractedCount >= 2) return true;
  const n = text(messageText).toLowerCase();
  const fieldMarkers = [
    n.includes('адрес:') && (n.includes('правил') || n.includes('wi-fi') || n.includes('wifi') || n.includes('канал')),
    /адрес:.*апартамент.*правил/i.test(n),
    /канал.*,.*авито|правил.*,.*кур/i.test(n),
    /заезд.*,.*выезд.*,.*канал/i.test(n),
    (n.match(/\. /g) ?? []).length >= 2 && (n.includes('правил') || n.includes('wi-fi') || n.includes('wifi') || n.includes('канал')),
  ];
  return fieldMarkers.some(Boolean);
}

type WizardApplyResult = {
  handled: boolean;
  extractedCount: number;
  savedField?: OwnerOnboardingWizardField;
  stayOnStep?: OwnerOnboardingWizardField;
  replyOverride?: string;
  replyMarkup?: TelegramInlineKeyboardMarkup;
  editInPlace?: boolean;
  editInPlaceMode?: OwnerOnboardingEditInPlaceMode;
  savedCustomChannelLabels?: string[];
};

function applyWizardCallback(state: OwnerOnboardingState, callbackData: string): WizardApplyResult {
  const action = parseWizardCallback(callbackData);
  switch (action.kind) {
    case 'noop':
      return { handled: false, extractedCount: 0 };
    case 'await_custom':
      state.awaiting_custom = action.field;
      if (action.field === 'channels') {
        return {
          handled: true,
          extractedCount: 0,
          stayOnStep: 'channels',
          replyOverride: CUSTOM_CHANNEL_INPUT_PROMPT_RU,
          editInPlace: true,
          editInPlaceMode: 'text',
        };
      }
      return {
        handled: true,
        extractedCount: 0,
        stayOnStep: action.field,
        replyOverride: CUSTOM_TIME_INPUT_PROMPT_RU,
      };
    case 'set_field':
      if (action.field === 'object_type') state.object_type = action.value;
      if (action.field === 'checkin_time') {
        state.checkin_time = action.value;
        state.awaiting_custom = undefined;
      }
      if (action.field === 'checkout_time') {
        state.checkout_time = action.value;
        state.awaiting_custom = undefined;
      }
      syncLegacyFields(state);
      state.last_saved_field = action.field;
      return { handled: true, extractedCount: 1, savedField: action.field };
    case 'toggle_channel': {
      const draft = new Set(state.channels_draft ?? []);
      if (draft.has(action.channelId)) draft.delete(action.channelId);
      else draft.add(action.channelId);
      state.channels_draft = [...draft];
      return {
        handled: true,
        extractedCount: 0,
        stayOnStep: 'channels',
        editInPlace: true,
        editInPlaceMode: 'markup',
        replyMarkup: buildWizardStepKeyboard('channels', { channels_draft: state.channels_draft, rules_draft: state.rules_draft ?? [] }),
      };
    }
    case 'confirm_channels': {
      const labels = labelsFromChannelIds(state.channels_draft ?? []);
      if (!labels.length) {
        return {
          handled: true,
          extractedCount: 0,
          stayOnStep: 'channels',
          editInPlace: true,
          editInPlaceMode: 'text',
          replyOverride: 'Выберите хотя бы один канал или нажмите на нужные пункты, затем «Готово».',
          replyMarkup: buildWizardStepKeyboard('channels', { channels_draft: state.channels_draft ?? [], rules_draft: state.rules_draft ?? [] }),
        };
      }
      state.channels_list = labels;
      state.channels = labels.join(', ');
      state.channels_draft = [];
      state.last_saved_field = 'channels';
      syncLegacyFields(state);
      return { handled: true, extractedCount: 1, savedField: 'channels' };
    }
    case 'toggle_rule': {
      const draft = new Set(state.rules_draft ?? []);
      if (draft.has(action.ruleId)) draft.delete(action.ruleId);
      else draft.add(action.ruleId);
      state.rules_draft = [...draft];
      return {
        handled: true,
        extractedCount: 0,
        stayOnStep: 'rules',
        editInPlace: true,
        editInPlaceMode: 'markup',
        replyMarkup: buildWizardStepKeyboard('rules', { channels_draft: state.channels_draft ?? [], rules_draft: state.rules_draft ?? [] }),
      };
    }
    case 'confirm_rules': {
      const labels = labelsFromRuleIds(state.rules_draft ?? []);
      if (!labels.length) {
        return {
          handled: true,
          extractedCount: 0,
          stayOnStep: 'rules',
          editInPlace: true,
          editInPlaceMode: 'text',
          replyOverride: 'Выберите хотя бы одно правило, затем нажмите «Готово».',
          replyMarkup: buildWizardStepKeyboard('rules', { channels_draft: state.channels_draft ?? [], rules_draft: state.rules_draft ?? [] }),
        };
      }
      state.rules = labels;
      state.house_rules = labels.join(', ');
      state.rules_draft = [];
      state.last_saved_field = 'rules';
      syncLegacyFields(state);
      return { handled: true, extractedCount: 1, savedField: 'rules' };
    }
    case 'wifi_later':
      state.wifi_skipped = true;
      state.wifi = 'добавлю позже';
      state.last_saved_field = 'wifi';
      syncLegacyFields(state);
      return { handled: true, extractedCount: 1, savedField: 'wifi' };
    case 'photo_later':
      state.photos_intent = 'later';
      state.last_saved_field = 'photos';
      return { handled: true, extractedCount: 1, savedField: 'photos' };
    default:
      return { handled: false, extractedCount: 0 };
  }
}

function applyLegacyBulkFacts(
  state: OwnerOnboardingState,
  messageText: string,
  hasPhoto: boolean,
): number {
  const deterministicFacts = extractFactsDeterministic(
    messageText,
    Object.keys(LEGACY_FIELD_LABELS) as OwnerOnboardingField[],
    hasPhoto,
  );
  let extractedCount = applySmartFactsToState(state, {
    ...deterministicFacts,
    city: deterministicFacts.city,
    photos_intent: deterministicFacts.photos_intent ?? undefined,
  });
  if (deterministicFacts.city) state.city = deterministicFacts.city;
  if (deterministicFacts.photos_intent) state.photos_intent = deterministicFacts.photos_intent;
  if (hasPhoto && !state.photos) {
    state.photos = 'Фото получено в Telegram';
    state.photos_count = (state.photos_count ?? 0) + 1;
    extractedCount += 1;
  }
  if (!state.object_type && !state.property_name) {
    const propertyMatch = messageText.match(/(квартира|апартаменты|апартамент|дом|комната|студия|лофт)/i);
    if (propertyMatch) {
      state.object_type = propertyMatch[1];
      state.property_name = propertyMatch[1];
      extractedCount += 1;
    }
  }
  syncLegacyFields(state);
  return extractedCount;
}

function applyWizardTextStep(state: OwnerOnboardingState, messageText: string, hasPhoto: boolean): WizardApplyResult {
  const next = state.missing[0];

  if (/правил|курен|животн|тишин|залог|вечерин/i.test(messageText) && !(state.rules?.length ?? 0)) {
    const facts = extractFactsDeterministic(messageText, ['house_rules'], false);
    if (facts.house_rules) {
      state.rules = facts.house_rules.split(',').map((item) => item.trim()).filter(Boolean);
      state.house_rules = facts.house_rules;
      syncLegacyFields(state);
      state.last_saved_field = 'rules';
      return { handled: true, extractedCount: 1, savedField: 'rules' };
    }
  }

  if (state.awaiting_custom) {
    const field = state.awaiting_custom;
    if (field === 'channels') {
      const labels = parseCustomChannelsInput(messageText);
      if (!labels.length) {
        return {
          handled: true,
          extractedCount: 0,
          stayOnStep: 'channels',
          replyOverride: `Не поняла каналы. ${CUSTOM_CHANNEL_INPUT_PROMPT_RU}`,
        };
      }
      const draft = new Set(state.channels_draft ?? []);
      const before = new Set(draft);
      for (const id of resolveChannelDraftIds(labels)) {
        draft.add(id);
      }
      state.channels_draft = [...draft];
      state.awaiting_custom = undefined;
      const savedCustomChannelLabels = labels.filter((label) => {
        const ids = resolveChannelDraftIds([label]);
        return ids.some((id) => id.startsWith('c:') && !before.has(id));
      });
      return {
        handled: true,
        extractedCount: 0,
        stayOnStep: 'channels',
        replyMarkup: buildWizardStepKeyboard('channels', {
          channels_draft: state.channels_draft,
          rules_draft: state.rules_draft ?? [],
        }),
        savedCustomChannelLabels,
      };
    }

    const parsed = parseCustomTimeInput(messageText);
    if (!parsed) {
      return {
        handled: true,
        extractedCount: 0,
        stayOnStep: field,
        replyOverride:
          field === 'checkin_time'
            ? `Не поняла время. ${CUSTOM_TIME_INPUT_PROMPT_RU}`
            : `Не поняла время. ${CUSTOM_TIME_INPUT_PROMPT_RU}`,
      };
    }
    if (field === 'checkin_time') state.checkin_time = parsed;
    else state.checkout_time = parsed;
    state.awaiting_custom = undefined;
    syncLegacyFields(state);
    return { handled: true, extractedCount: 1, savedField: field };
  }

  if (next === 'address' && text(messageText) && !isIdentitySelectionText(messageText)) {
    if (/фото.*(позже|потом)|добавлю позже/i.test(messageText) && !/(адрес|ул\.?|улиц|просп)/i.test(messageText)) {
      return { handled: false, extractedCount: 0 };
    }
    const facts = extractFactsDeterministic(messageText, ['address'], false);
    if (facts.address || /(адрес|ул\.?|улиц|просп|наб\.?|переул|шоссе|лиговск|\d{1,4}|питер|спб|ебург|екат|москва|санкт)/i.test(messageText)) {
      state.address = facts.address ?? text(messageText, 400);
      if (facts.city) state.city = facts.city;
      state.last_saved_field = 'address';
      return { handled: true, extractedCount: 1, savedField: 'address' };
    }
    return {
      handled: true,
      extractedCount: 0,
      stayOnStep: 'address',
      replyOverride: 'Укажите адрес объекта.\nНапример:\nСанкт-Петербург, Лиговский пр., 108',
    };
  }

  if (next === 'object_type' && text(messageText) && !isIdentitySelectionText(messageText)) {
    const facts = extractFactsDeterministic(messageText, ['address', 'property_name'], false);
    if (!state.address && facts.address) {
      state.address = facts.address;
      if (facts.city) state.city = facts.city;
      syncLegacyFields(state);
      state.last_saved_field = 'address';
      return { handled: true, extractedCount: 1, savedField: 'address' };
    }
    if (facts.property_name || /(квартира|апартамент|студия|дом|комната|другое|лофт)/i.test(text(messageText, 120))) {
      state.object_type = facts.property_name ?? text(messageText, 120);
      syncLegacyFields(state);
      state.last_saved_field = 'object_type';
      return { handled: true, extractedCount: 1, savedField: 'object_type' };
    }
  }

  if (next === 'checkin_time') {
    const facts = extractFactsDeterministic(messageText, ['checkin_checkout'], false);
    if (facts.checkin_checkout) {
      const checkinMatch = facts.checkin_checkout.match(/заезд[^,.;]*/i);
      const checkoutMatch = facts.checkin_checkout.match(/выезд[^,.;]*/i);
      if (checkinMatch) state.checkin_time = checkinMatch[0].replace(/^заезд\s*/i, '').trim();
      if (checkoutMatch) state.checkout_time = checkoutMatch[0].replace(/^выезд\s*/i, '').trim();
      syncLegacyFields(state);
      state.last_saved_field = state.checkout_time ? 'checkout_time' : 'checkin_time';
      return { handled: true, extractedCount: state.checkout_time ? 2 : 1, savedField: 'checkin_time' };
    }
    const parsed = parseCustomTimeInput(messageText);
    if (parsed) {
      state.checkin_time = parsed;
      syncLegacyFields(state);
      state.last_saved_field = 'checkin_time';
      return { handled: true, extractedCount: 1, savedField: 'checkin_time' };
    }
  }

  if (next === 'checkout_time') {
    const facts = extractFactsDeterministic(messageText, ['checkin_checkout'], false);
    if (facts.checkin_checkout) {
      const checkoutMatch = facts.checkin_checkout.match(/выезд[^,.;]*/i);
      if (checkoutMatch) {
        state.checkout_time = checkoutMatch[0].replace(/^выезд\s*/i, '').trim();
        syncLegacyFields(state);
        state.last_saved_field = 'checkout_time';
        return { handled: true, extractedCount: 1, savedField: 'checkout_time' };
      }
    }
    const parsed = parseCustomTimeInput(messageText);
    if (parsed) {
      state.checkout_time = parsed;
      syncLegacyFields(state);
      state.last_saved_field = 'checkout_time';
      return { handled: true, extractedCount: 1, savedField: 'checkout_time' };
    }
  }

  if (next === 'rules' && text(messageText)) {
    const facts = extractFactsDeterministic(messageText, ['house_rules'], false);
    if (facts.house_rules) {
      state.rules = facts.house_rules.split(',').map((item) => item.trim()).filter(Boolean);
      state.house_rules = facts.house_rules;
      syncLegacyFields(state);
      state.last_saved_field = 'rules';
      return { handled: true, extractedCount: 1, savedField: 'rules' };
    }
  }

  if (next === 'channels' && text(messageText)) {
    const facts = extractFactsDeterministic(messageText, ['channels'], false);
    if (facts.channels) {
      state.channels_list = facts.channels.split(',').map((item) => item.trim()).filter(Boolean);
      state.channels = facts.channels;
      syncLegacyFields(state);
      state.last_saved_field = 'channels';
      return { handled: true, extractedCount: 1, savedField: 'channels' };
    }
  }

  if (next === 'wifi' && text(messageText)) {
    const parsed = parseWifiInput(messageText);
    state.wifi_name = parsed.wifi_name;
    state.wifi_password = parsed.wifi_password;
    state.wifi_skipped = false;
    syncLegacyFields(state);
    state.last_saved_field = 'wifi';
    return { handled: true, extractedCount: 1, savedField: 'wifi' };
  }

  if (next === 'photos') {
    if (hasPhoto) {
      state.photos = 'Фото получено в Telegram';
      state.photos_count = (state.photos_count ?? 0) + 1;
      state.photos_intent = 'now';
      state.last_saved_field = 'photos';
      return { handled: true, extractedCount: 1, savedField: 'photos' };
    }
    const n = text(messageText).toLowerCase();
    if (/фото.*(позже|потом)|добавлю позже/.test(n)) {
      state.photos_intent = 'later';
      state.last_saved_field = 'photos';
      return { handled: true, extractedCount: 1, savedField: 'photos' };
    }
  }

  return { handled: false, extractedCount: 0 };
}

function wizardStateSnapshot(state: OwnerOnboardingState) {
  return {
    address: state.address,
    object_type: state.object_type ?? state.property_name,
    checkin_time: state.checkin_time,
    checkout_time: state.checkout_time,
    channels: state.channels_list,
    rules: state.rules,
    wifi_name: state.wifi_name,
    wifi_password: state.wifi_password,
    wifi_skipped: state.wifi_skipped,
    photos: state.photos,
    photos_intent: state.photos_intent,
    photos_count: state.photos_count,
  };
}

function wizardDraftSnapshot(state: OwnerOnboardingState) {
  return {
    channels_draft: state.channels_draft ?? [],
    rules_draft: state.rules_draft ?? [],
  };
}

function buildReply(params: {
  status: OwnerOnboardingStatus;
  missing: OwnerOnboardingWizardField[];
  savedField?: OwnerOnboardingWizardField;
  decision: SmartParseDecision;
  photosIntent?: PhotosIntent;
  readiness?: ObjectReadinessResult;
  state: OwnerOnboardingState;
  replyOverride?: string;
  replyMarkup?: TelegramInlineKeyboardMarkup;
}): { text: string; markup?: TelegramInlineKeyboardMarkup } {
  if (params.status === 'needs_operator') {
    return {
      text: 'Похоже, здесь нужна ручная помощь. Я передала диалог оператору: он посмотрит данные объекта и ответит здесь.',
    };
  }
  if (params.status === 'channel_manager_started') {
    return {
      text: 'Отлично, отметила старт Менеджера каналов. Если на шаге подключения что-то остановит процесс, напишите сюда — подключу оператора.',
    };
  }
  if (params.status === 'ready_for_channel_manager') {
    const progress = params.readiness
      ? buildWizardProgressBlock({
          completedCount: wizardCompletedCount(wizardStateSnapshot(params.state)),
          readinessPercent: params.readiness.readiness_percent,
          checklist: buildWizardChecklist(wizardStateSnapshot(params.state)),
        })
      : '';
    return {
      text: [
        progress,
        'Минимальные данные по объекту собраны. Объект готов к следующему шагу — Менеджеру каналов.',
        `Открыть: ${CHANNEL_MANAGER_URL}`,
        'Реальных вызовов к площадкам сейчас не делаю: это подготовка к подключению.',
      ]
        .filter(Boolean)
        .join('\n\n'),
      markup: readyMarkup(params.status),
    };
  }

  const next = params.missing[0] ?? 'address';
  const completedCount = wizardCompletedCount(wizardStateSnapshot(params.state));
  const progress = params.readiness
    ? buildWizardProgressBlock({
        completedCount,
        readinessPercent: params.readiness.readiness_percent,
      })
    : '';

  if (params.replyOverride) {
    const ack = params.savedField ? fieldSavedAckRu(params.savedField) : '';
    const skipKeyboard = Boolean(params.state.awaiting_custom);
    return {
      text: [ack, progress, params.replyOverride].filter(Boolean).join('\n\n'),
      markup:
        params.replyMarkup ??
        (skipKeyboard ? undefined : buildWizardStepKeyboard(next, wizardDraftSnapshot(params.state))),
    };
  }

  if (params.decision.clarification_question && params.decision.needs_clarification) {
    return {
      text: [progress, params.decision.clarification_question].filter(Boolean).join('\n\n'),
      markup: buildWizardStepKeyboard(next, wizardDraftSnapshot(params.state)),
    };
  }

  if (params.state.wizard_mode !== 'legacy') {
    if (!params.savedField && params.status === 'onboarding_started' && next === 'address') {
      return {
        text: ['Поняла. Помогу подключить объект к ASI.', progress, buildWizardStepPrompt('address')].filter(Boolean).join('\n\n'),
      };
    }

    const ack =
      params.savedField === 'address'
        ? '✓ Адрес сохранён'
        : params.savedField
          ? fieldSavedAckRu(params.savedField)
          : '';
    const question = buildWizardStepPrompt(next);
    return {
      text: [ack, progress, question].filter(Boolean).join('\n\n'),
      markup: params.replyMarkup ?? buildWizardStepKeyboard(next, wizardDraftSnapshot(params.state)),
    };
  }

  const savedLegacy = params.savedField ? REQUIRED_FIELD_LABELS_RU[params.savedField] ?? params.savedField : '';
  const questionLegacy = next ? `Следующий шаг: ${LEGACY_FIELD_LABELS[next as OwnerOnboardingField] ?? next}` : '';
  return {
    text: [
      savedLegacy ? `Поняла, ${savedLegacy} сохранила.` : 'Начнём подключение объекта к ASI.',
      progress,
      params.missing.length ? `Сейчас не хватает: ${missingListRu(params.missing)}.` : '',
      questionLegacy,
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

function readyMarkup(status: OwnerOnboardingStatus): TelegramInlineKeyboardMarkup | undefined {
  if (status !== 'ready_for_channel_manager' && status !== 'channel_manager_started') return undefined;
  return {
    inline_keyboard: [[{ text: 'Открыть Менеджер каналов', url: CHANNEL_MANAGER_URL }]],
  };
}

function noteWithoutStructuredBlocks(note: string): string {
  const lines = text(note, 4000).split('\n');
  const blockStarts = new Set([NOTE_HEADER, OWNER_OBJECTS_HEADER]);
  const kept: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const trimmed = lines[index].trim();
    if (blockStarts.has(trimmed)) {
      index += 1;
      while (index < lines.length && lines[index].trim() !== '') index += 1;
      if (lines[index]?.trim() === '') index += 1;
      continue;
    }
    kept.push(lines[index]);
    index += 1;
  }
  return kept.join('\n').trim();
}

function buildOwnerObjectsNoteBlock(chatId: number, channel: CommunicationChannel): string {
  const records = listOwnerObjectRecords(chatId, channel);
  if (records.length === 0) return '';
  const lines = records.map(
    (item) =>
      `${item.objectId} | ${item.title} | готовность: ${item.readinessPercent}% | активная сессия: ${item.isActiveSession ? 'да' : 'нет'}`,
  );
  return [OWNER_OBJECTS_HEADER, ...lines].join('\n');
}

function buildCrmNote(params: {
  existingNote?: string | null;
  state: OwnerOnboardingState;
  chatId: number;
  channel: CommunicationChannel;
  objectId: string;
}): string {
  const base = noteWithoutStructuredBlocks(params.existingNote ?? '');
  const readiness = params.state.readiness;
  const block = [
    NOTE_HEADER,
    `object_id=${params.objectId}`,
    `owner_id=${params.chatId}`,
    `is_active_session=да`,
    `Статус: ${params.state.status}`,
    readiness ? `Готовность: ${readiness.readiness_percent}%` : null,
    readiness ? `Статус готовности: ${readiness.readiness_status_label_ru}` : null,
    params.state.city ? `Город: ${params.state.city}` : null,
    params.state.object_type ? `Тип объекта: ${params.state.object_type}` : null,
    params.state.checkin_time ? `Заезд: ${params.state.checkin_time}` : null,
    params.state.checkout_time ? `Выезд: ${params.state.checkout_time}` : null,
    params.state.channels_list?.length ? `Каналы: ${params.state.channels_list.join(', ')}` : null,
    params.state.rules?.length ? `Правила: ${params.state.rules.join(', ')}` : null,
    params.state.wifi_name ? `Wi-Fi имя: ${params.state.wifi_name}` : null,
    params.state.wifi_password ? `Wi-Fi пароль: ${params.state.wifi_password}` : null,
    params.state.wifi_skipped ? 'Wi-Fi: добавлю позже' : null,
    `Фото: ${params.state.photos_count ?? 0}`,
    params.state.photos_intent === 'later' ? 'Фото: обещаны позже' : null,
    `Не хватает: ${params.state.missing.length ? missingListRu(params.state.missing) : 'ничего'}`,
    readiness && readiness.missing_optional_labels_ru.length
      ? `Не хватает (дополнительно): ${readiness.missing_optional_labels_ru.join(', ')}`
      : null,
    readiness ? `Следующий шаг: ${readiness.next_best_step_ru}` : null,
    `Последнее сообщение: ${params.state.lastMessage || 'нет текста'}`,
    `Менеджер каналов: ${CHANNEL_MANAGER_HREF}`,
  ]
    .filter(Boolean)
    .join('\n');
  const objectsBlock = buildOwnerObjectsNoteBlock(params.chatId, params.channel);
  return [base, objectsBlock, block].filter(Boolean).join('\n\n').slice(0, 2000);
}

async function findCrmContact(envelope: InboundMessageEnvelope): Promise<{ id: string; notes?: string | null } | null> {
  const username = telegramUsername(envelope);
  const contactKey = telegramContactKey(envelope);
  try {
    if (username) {
      const { data, error } = await supabase
        .from('crm_contacts')
        .select('id,notes')
        .eq('telegram_username', username)
        .maybeSingle();
      if (!error && data) return data as { id: string; notes?: string | null };
    }
    if (contactKey) {
      const { data, error } = await supabase
        .from('crm_contacts')
        .select('id,notes')
        .eq('contact', contactKey)
        .maybeSingle();
      if (!error && data) return data as { id: string; notes?: string | null };
    }
  } catch {
    return null;
  }
  return null;
}

async function upsertCrmContact(params: {
  envelope: InboundMessageEnvelope;
  chatId: number;
  senderIdentity: SenderIdentity;
  state: OwnerOnboardingState;
  objectId: string;
}): Promise<string | undefined> {
  const contactKey = telegramContactKey(params.envelope);
  if (!contactKey) return undefined;
  const existing = await findCrmContact(params.envelope);
  const username = telegramUsername(params.envelope);
  const now = new Date().toISOString();
  const objectsCount = listOwnerObjectRecords(params.chatId, params.envelope.channel).length;
  const role = params.senderIdentity === 'owner' || params.senderIdentity === 'manager' ? params.senderIdentity : 'unknown';
  const crmStatus =
    params.state.status === 'ready_for_channel_manager' || params.state.status === 'channel_manager_started'
      ? 'object_setup'
      : params.state.status === 'needs_operator'
        ? 'contact'
        : params.state.status === 'onboarding_started'
          ? 'contact'
          : 'waiting_object_data';
  const communicationStatus = params.state.status === 'needs_operator' ? 'needs_manual_reaction' : 'waiting_reply';
  const nextAction =
    params.state.status === 'ready_for_channel_manager'
      ? 'Открыть Менеджер каналов и начать подключение каналов.'
      : params.state.status === 'channel_manager_started'
        ? 'Проверить старт Менеджера каналов.'
        : params.state.status === 'needs_operator'
          ? 'Оператору нужно ответить вручную по онбордингу объекта.'
          : params.state.readiness?.next_best_step_ru ??
            `Запросить: ${REQUIRED_FIELD_LABELS_RU[params.state.missing[0] ?? 'address']}.`;
  const notes = buildCrmNote({
    existingNote: existing?.notes,
    state: params.state,
    chatId: params.chatId,
    channel: params.envelope.channel,
    objectId: params.objectId,
  });

  try {
    if (existing?.id) {
      const { error } = await supabase
        .from('crm_contacts')
        .update({
          role,
          status: crmStatus,
          communication_status: communicationStatus,
          last_activity_at: now,
          next_action: nextAction,
          notes,
          city: params.state.city ?? null,
          property_count: objectsCount,
        })
        .eq('id', existing.id);
      return error ? undefined : existing.id;
    }

    const { data, error } = await supabase
      .from('crm_contacts')
      .insert({
        name: telegramDisplayName(params.envelope),
        phone: null,
        contact: contactKey,
        telegram_username: username || null,
        email: null,
        role,
        source: 'telegram',
        property_count: objectsCount,
        city: params.state.city ?? null,
        notes,
        status: crmStatus,
        communication_status: communicationStatus,
        last_activity_at: now,
        next_action: nextAction,
        next_action_due_at: null,
      })
      .select('id')
      .single();
    if (error || !data) return undefined;
    return String((data as { id?: unknown }).id ?? '') || undefined;
  } catch {
    return undefined;
  }
}

function persistState(chatId: number, channel: CommunicationChannel, state: OwnerOnboardingState): string {
  const objectId = getActiveOwnerObjectId(chatId, channel);
  persistOwnerObjectState(chatId, channel, objectId, state);
  return objectId;
}

export async function processTelegramOwnerOnboarding(params: {
  envelope: InboundMessageEnvelope;
  chatId: number;
  senderIdentity: SenderIdentity;
}): Promise<OwnerOnboardingResult> {
  if (params.envelope.channel !== 'telegram') {
    const state = readStateFromSession(params.chatId, params.envelope.channel);
    return { handled: false, replyText: '', status: state.status, missing: state.missing, state };
  }
  if (params.senderIdentity !== 'owner' && params.senderIdentity !== 'manager' && params.senderIdentity !== 'lead') {
    const state = readStateFromSession(params.chatId, params.envelope.channel);
    return { handled: false, replyText: '', status: state.status, missing: state.missing, state };
  }

  const wizardCallback = text((params.envelope.metadata as any)?.telegram_onboarding_wizard_callback, 64);
  const sessionRouterCallback = text(
    (params.envelope.metadata as any)?.telegram_session_router_callback ??
      ((params.envelope.metadata as any)?.telegram_callback_data &&
      isSessionRouterCallback((params.envelope.metadata as any)?.telegram_callback_data)
        ? (params.envelope.metadata as any)?.telegram_callback_data
        : ''),
    64,
  );

  const existingCrm = await findCrmContact(params.envelope);
  const routed = await tryHandleOwnerSessionRouter({
    envelope: params.envelope,
    chatId: params.chatId,
    channel: params.envelope.channel,
    senderIdentity: params.senderIdentity,
    crmContactId: existingCrm?.id,
    sessionRouterCallback,
    wizardCallback,
  });
  if (routed) {
    routed.state.readiness = computeObjectReadiness(
      readinessInputFromOnboardingState({
        ...routed.state,
        channels: routed.state.channels_list ?? routed.state.channels,
        rules: routed.state.rules ?? routed.state.house_rules,
        status: routed.state.status,
      }),
    );
    const objectId = persistState(params.chatId, params.envelope.channel, routed.state);
    const crmContactId = await upsertCrmContact({
      envelope: params.envelope,
      chatId: params.chatId,
      senderIdentity: params.senderIdentity,
      state: routed.state,
      objectId,
    });
    return { ...routed, crmContactId };
  }

  ensureOwnerObjectsRegistry(params.chatId, params.envelope.channel);

  const previous = readStateFromSession(params.chatId, params.envelope.channel);
  const merged: OwnerOnboardingState = {
    ...previous,
    wizard_mode: previous.wizard_mode ?? 'v2',
    lastMessage: text(params.envelope.messageText, 600),
    channelManagerHref: CHANNEL_MANAGER_HREF,
  };

  const hasPhoto = Array.isArray((params.envelope.metadata as any)?.attachments)
    ? (params.envelope.metadata as any).attachments.some((attachment: any) => attachment?.type === 'photo')
    : false;

  let extractedCount = 0;
  let savedField: OwnerOnboardingWizardField | undefined;
  let replyOverride: string | undefined;
  let replyMarkup: TelegramInlineKeyboardMarkup | undefined;
  let editInPlace: boolean | undefined;
  let editInPlaceMode: OwnerOnboardingEditInPlaceMode | undefined;
  let savedCustomChannelLabels: string[] | undefined;
  let decision: SmartParseDecision = {
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
    },
    confidence: 'high',
    needs_clarification: false,
    clarification_question: null,
    needs_operator: false,
    operator_reason: null,
    next_missing_field: null,
    source: 'deterministic',
  };

  if (wizardCallback && isWizardCallbackData(wizardCallback)) {
    const wizardResult = applyWizardCallback(merged, wizardCallback);
    extractedCount = wizardResult.extractedCount;
    savedField = wizardResult.savedField;
    replyOverride = wizardResult.replyOverride;
    replyMarkup = wizardResult.replyMarkup;
    editInPlace = wizardResult.editInPlace;
    editInPlaceMode = wizardResult.editInPlaceMode;
    if (wizardResult.stayOnStep) {
      merged.missing = missingFields(merged);
      merged.missing = [wizardResult.stayOnStep, ...merged.missing.filter((field) => field !== wizardResult.stayOnStep)];
    }
    merged.clarification_attempts = extractedCount > 0 ? 0 : previous.clarification_attempts;
  } else if (isIdentitySelectionText(params.envelope.messageText ?? '')) {
    extractedCount = 0;
  } else if (merged.wizard_mode !== 'legacy') {
    merged.missing = missingFields(merged);
    const messageText = params.envelope.messageText ?? '';
    const next = merged.missing[0];

    if (shouldUseLegacyFallback(merged, 0, messageText)) {
      extractedCount = applyLegacyBulkFacts(merged, messageText, hasPhoto);
    } else if (
      next === 'address' &&
      text(messageText) &&
      !isIdentitySelectionText(messageText) &&
      !/фото.*(позже|потом)|добавлю позже/i.test(messageText)
    ) {
      const smartResult = await extractOnboardingFactsSmart({
        messageText: params.envelope.messageText ?? '',
        hasPhoto,
        missing: merged.missing as OwnerOnboardingField[],
        collected: merged,
        city: merged.city,
        photosIntent: merged.photos_intent,
        status: merged.status,
      });
      decision = smartResult.decision;
      if (smartResult.facts.city) merged.city = smartResult.facts.city;
      if (smartResult.facts.address && !decision.needs_clarification) {
        merged.address = smartResult.facts.address;
        extractedCount = 1;
        savedField = 'address';
      } else if (decision.needs_clarification) {
        if (decision.confidence === 'high' && smartResult.facts.address) {
          merged.address = smartResult.facts.address;
          extractedCount = 1;
          savedField = 'address';
        } else {
          extractedCount = smartResult.facts.city ? 1 : 0;
        }
        replyOverride = decision.clarification_question ?? undefined;
      }
    } else {
      const wizardTextResult = applyWizardTextStep(merged, params.envelope.messageText ?? '', hasPhoto);
      if (wizardTextResult.handled) {
        extractedCount = wizardTextResult.extractedCount;
        savedField = wizardTextResult.savedField;
        replyOverride = wizardTextResult.replyOverride;
        replyMarkup = wizardTextResult.replyMarkup;
        savedCustomChannelLabels = wizardTextResult.savedCustomChannelLabels;
        if (wizardTextResult.stayOnStep) {
          merged.missing = missingFields(merged);
          merged.missing = [
            wizardTextResult.stayOnStep,
            ...merged.missing.filter((field) => field !== wizardTextResult.stayOnStep),
          ];
        }
      } else if (shouldUseLegacyFallback(merged, 0, messageText)) {
        extractedCount = applyLegacyBulkFacts(merged, messageText, hasPhoto);
      } else {
        const deterministicFacts = extractFactsDeterministic(
          params.envelope.messageText ?? '',
          legacyMissingFields(merged.missing),
          hasPhoto,
        );
        extractedCount = applySmartFactsToState(merged, {
          ...deterministicFacts,
          city: deterministicFacts.city,
          photos_intent: deterministicFacts.photos_intent ?? undefined,
        });
        merged.city = deterministicFacts.city ?? merged.city;
        merged.photos_intent = deterministicFacts.photos_intent ?? merged.photos_intent;
      }
    }
  } else {
    const smartResult = await extractOnboardingFactsSmart({
      messageText: params.envelope.messageText ?? '',
      hasPhoto,
      missing: merged.missing as OwnerOnboardingField[],
      collected: merged,
      city: merged.city,
      photosIntent: merged.photos_intent,
      status: merged.status,
    });
    decision = smartResult.decision;
    const fieldFacts: Partial<Record<OwnerOnboardingField, string>> = {};
    for (const field of Object.keys(LEGACY_FIELD_LABELS) as OwnerOnboardingField[]) {
      if (smartResult.facts[field]) fieldFacts[field] = smartResult.facts[field];
    }
    extractedCount = applySmartFactsToState(merged, {
      ...fieldFacts,
      city: smartResult.facts.city,
      photos_intent: smartResult.facts.photos_intent ?? undefined,
    });
    merged.city = smartResult.facts.city ?? merged.city;
    merged.photos_intent = smartResult.facts.photos_intent ?? merged.photos_intent;
  }

  merged.clarification_attempts = wizardCallback
    ? merged.clarification_attempts
    : nextClarificationAttempts({
        previousAttempts: previous.clarification_attempts,
        extractedCount,
        messageText: params.envelope.messageText ?? '',
        decision,
        previousStatus: previous.status,
      });

  merged.missing = missingFields(merged);
  merged.status = statusForState({
    previousStatus: previous.status,
    missing: merged.missing,
    extractedCount,
    messageText: params.envelope.messageText ?? '',
    decision,
    clarificationAttempts: merged.clarification_attempts,
  });

  merged.readiness = computeObjectReadiness(
    readinessInputFromOnboardingState({
      ...merged,
      channels: merged.channels_list ?? merged.channels,
      rules: merged.rules ?? merged.house_rules,
      status: merged.status,
    }),
  );

  const previousReadinessPercentRaw = text(
    loadAutonomousSession(params.chatId)?.collected_data?.[`${SESSION_PREFIX}readiness_percent`],
  );
  const previousReadinessPercent = previousReadinessPercentRaw ? Number(previousReadinessPercentRaw) : null;
  const previousReadinessForEvents = computeObjectReadiness(
    readinessInputFromOnboardingState({
      ...previous,
      channels: previous.channels_list ?? previous.channels,
      rules: previous.rules ?? previous.house_rules,
      status: previous.status,
    }),
  );

  if (decision.clarification_question) {
    merged.lastClarificationQuestion = decision.clarification_question;
  }

  const objectId = persistState(params.chatId, params.envelope.channel, merged);

  const crmContactId = await upsertCrmContact({
    envelope: params.envelope,
    chatId: params.chatId,
    senderIdentity: params.senderIdentity,
    state: merged,
    objectId,
  });

  await emitObjectReadinessEvents({
    contactId: crmContactId,
    previousPercent: previousReadinessPercent,
    previousStatus: previousReadinessForEvents.readiness_status,
    readiness: merged.readiness,
    photosIntentLater: merged.photos_intent === 'later',
  });

  await emitOnboardingChannelSavedEvents({
    contactId: crmContactId,
    channelLabels: savedCustomChannelLabels ?? [],
  });

  const reply = buildReply({
    status: merged.status,
    missing: merged.missing,
    savedField,
    decision,
    photosIntent: merged.photos_intent,
    readiness: merged.readiness,
    state: merged,
    replyOverride,
    replyMarkup,
  });

  return {
    handled: true,
    replyText: reply.text,
    replyMarkup: reply.markup,
    editInPlace,
    editInPlaceMode,
    status: merged.status,
    missing: merged.missing,
    crmContactId,
    state: merged,
  };
}

export { extractFactsDeterministic, isIdentitySelectionText, detectsExplicitOperatorRequest, WIZARD_FIELD_ORDER };
