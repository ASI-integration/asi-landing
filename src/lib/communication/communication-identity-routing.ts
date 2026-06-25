import { supabase } from '@/lib/supabase';
import { loadAutonomousSession } from './conversation-session-store';
import { classifyGuestCommunicationIntent, isGuestConciergeIntent } from './guest-intent-router';
import {
  extractFactsDeterministic,
  isIdentitySelectionText,
  type OwnerOnboardingField,
} from './owner-onboarding-smart-parser';
import type { InboundMessageEnvelope, IdentityResolution } from './types';

export type SenderIdentity =
  | 'guest'
  | 'owner'
  | 'manager'
  | 'lead'
  | 'support_problem'
  | 'unknown'
  | 'test_guest'
  | 'internal_operator';

export type CommunicationIdentityRoute =
  | 'guest_concierge'
  | 'guest_selected'
  | 'owner_manager'
  | 'lead'
  | 'support_problem'
  | 'unknown_clarify'
  | 'role_conflict_guest_question'
  | 'object_problem_clarify'
  | 'internal_operator';

export type TelegramInlineKeyboardButton = {
  text: string;
  callback_data?: string;
  url?: string;
};

export type TelegramInlineKeyboardMarkup = {
  inline_keyboard: TelegramInlineKeyboardButton[][];
};

export type TelegramReplyKeyboardMarkup = {
  keyboard: string[][];
  resize_keyboard?: boolean;
  one_time_keyboard?: boolean;
  input_field_placeholder?: string;
};

export type CommunicationIdentityRoutingDecision = {
  senderIdentity: SenderIdentity;
  route: CommunicationIdentityRoute;
  shouldRunGuestConcierge: boolean;
  replyText?: string;
  replyMarkup?: TelegramInlineKeyboardMarkup | TelegramReplyKeyboardMarkup;
  selectedIdentity?: SenderIdentity;
  crmContactId?: string;
  reason: string;
  audit: Record<string, unknown>;
};

export const UNKNOWN_IDENTITY_CLARIFY_RU =
  'Здравствуйте! Чем могу помочь?';

export const RESET_IDENTITY_CLARIFY_RU =
  'Идентичность и сессия сброшены. Чем могу помочь?';

const IDENTITY_SELECTION_TEXTS = new Set([
  'Я владелец / управляющий объекта',
  'Хочу подключить ASI',
  'Нужна поддержка',
  'Я гость',
  'Я владелец/управляющий',
]);

const PROBLEM_IDENTITY_CLARIFY_RU =
  'Проблема связана с вашим проживанием как гостя или с объектом, которым вы управляете?';

const GUEST_SELECTED_REPLY_RU =
  'Поняла, вы гость. Напишите вопрос по объекту — адрес, заезд, Wi-Fi, правила. Если бронь ещё не привязана, укажите номер бронирования или телефон из брони.';

const LEAD_REPLY_RU =
  'Поняла. Помогу подключить объект к ASI.\n\nДля начала укажите адрес объекта.';

const OWNER_MANAGER_REPLY_RU =
  'Поняла, вы владелец/управляющий. Опишите, пожалуйста, объект или ситуацию, которую нужно разобрать. Я передам это как внутреннее обращение.';

const SUPPORT_PROBLEM_REPLY_RU =
  'Поняла. Опишите, пожалуйста, что случилось. Если это связано с проживанием, укажите объект или бронь. Если это вопрос владельца/управляющего, напишите объект и ситуацию.';

const INTERNAL_OPERATOR_REPLY_RU =
  'Операторский контекст принят. Гостевой автопилот для этого сообщения не запущен.';

export const ROLE_CONFLICT_GUEST_QUESTION_RU =
  'Похоже, это вопрос гостя по проживанию. Переключить этот диалог в гостевой сценарий?';

export const ONBOARDING_SCENARIO_SWITCH_CONFIRM_RU =
  'Сейчас мы подключаем объект к ASI. Хотите выйти из этого сценария и перейти к другому вопросу?';

export const TELEGRAM_IDENTITY_CALLBACKS = {
  guest: 'identity:guest',
  ownerManager: 'identity:owner_manager',
  lead: 'identity:lead',
  supportProblem: 'identity:support_problem',
} as const;

export const UNKNOWN_IDENTITY_INLINE_KEYBOARD: TelegramInlineKeyboardMarkup = {
  inline_keyboard: [
    [
      { text: 'Подключить объект', callback_data: TELEGRAM_IDENTITY_CALLBACKS.lead },
      { text: 'Вопрос по проживанию', callback_data: TELEGRAM_IDENTITY_CALLBACKS.guest },
    ],
    [
      { text: 'Поддержка', callback_data: TELEGRAM_IDENTITY_CALLBACKS.supportProblem },
      { text: 'Другое', callback_data: TELEGRAM_IDENTITY_CALLBACKS.supportProblem },
    ],
  ],
};

export const ROLE_CONFLICT_GUEST_INLINE_KEYBOARD: TelegramInlineKeyboardMarkup = {
  inline_keyboard: [
    [
      { text: 'Перейти к вопросу', callback_data: TELEGRAM_IDENTITY_CALLBACKS.guest },
      { text: 'Продолжить подключение', callback_data: TELEGRAM_IDENTITY_CALLBACKS.ownerManager },
    ],
  ],
};

export const PROBLEM_IDENTITY_REPLY_KEYBOARD: TelegramReplyKeyboardMarkup = {
  keyboard: [['Я гость', 'Я владелец/управляющий']],
  resize_keyboard: true,
  one_time_keyboard: true,
  input_field_placeholder: 'Выберите роль',
};

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function norm(value: unknown): string {
  return text(value).toLowerCase().replace(/^@+/, '');
}

function hasTelegramTestMode(envelope: InboundMessageEnvelope): boolean {
  const metadata = envelope.metadata ?? {};
  return (
    text(envelope.messageText).startsWith('/guest_test') ||
    metadata.guestTestMode === true ||
    metadata.guest_test_mode === true ||
    norm(metadata.senderIdentity) === 'test_guest'
  );
}

function isLeadIntent(messageText: string): boolean {
  const t = messageText.toLowerCase();
  return (
    /^хочу\s+подключить\s+asi$/i.test(text(messageText)) ||
    /\basi\b/i.test(messageText) ||
    /подключ|пилот|ранн(ий|его) доступ|автоматизац|сервис|демо|заявк/.test(t) ||
    /хочу\s+(подключить|добавить|настроить).*(квартир|объект|апартамент)/.test(t) ||
    /(сдаю|управляю).*(квартир|апартамент|объект).*(посуточ|краткосрочн)?/.test(t) ||
    /хочу\s+начать\s+пользоваться/.test(t)
  );
}

function activeOwnerOnboarding(envelope: InboundMessageEnvelope): {
  active: boolean;
  senderIdentity: SenderIdentity | null;
  missing: string[];
} {
  if (envelope.channel !== 'telegram') return { active: false, senderIdentity: null, missing: [] };
  const chatId = Number(envelope.chatId ?? envelope.metadata?.telegram_chat_id);
  if (!Number.isFinite(chatId)) return { active: false, senderIdentity: null, missing: [] };
  const session = loadAutonomousSession(chatId);
  const collected = session?.collected_data ?? {};
  const status = norm(collected.owner_onboarding_status);
  if (!status || status === 'ready_for_channel_manager' || status === 'channel_manager_started') {
    return { active: false, senderIdentity: null, missing: [] };
  }
  const identity = session?.identity_role === 'owner' || session?.identity_role === 'manager' ? session.identity_role : 'lead';
  return {
    active: true,
    senderIdentity: identity,
    missing: text(collected.owner_onboarding_missing).split(',').map((item) => item.trim()).filter(Boolean),
  };
}

function looksLikeOwnerOnboardingContinuation(messageText: string, missing: string[]): boolean {
  const t = norm(messageText).replace(/ё/g, 'е');
  if (!t) return false;
  if (isIdentitySelectionText(messageText)) return true;

  const fields = missing.length > 0 ? missing : ['address'];
  const facts = extractFactsDeterministic(messageText, fields as OwnerOnboardingField[], false);
  const extractedCount =
    Object.keys(facts).filter((key) => key !== 'city' && key !== 'photos_intent').length + (facts.photos_intent ? 1 : 0);
  if (extractedCount > 0) return true;

  if (fields.includes('address')) {
    return /(адрес|ул\.?|улиц|просп|наб\.?|переул|шоссе|лиговск|\d{1,4}|питер|спб|ебург|екат)/.test(t);
  }
  if (fields.includes('property_name') || fields.includes('object_type')) {
    if (/(квартир|апартамент|студия|дом|объект|лофт|номер|вокзал|комната)/.test(t)) return true;
  }
  if (fields.includes('house_rules') || fields.includes('rules')) {
    if (/(правил|курен|животн|тишин|залог|вечерин|нельзя|можно|обычн|дет)/.test(t)) return true;
  }
  if (fields.includes('wifi') && /(wi fi|wi-fi|wifi|вай фай|вайфай|сеть|парол|потом|позже|добавлю)/.test(t)) return true;
  if (fields.includes('checkin_checkout') || fields.includes('checkin_time') || fields.includes('checkout_time')) {
    if (/(заезд|выезд|check in|check out|\b\d{1,2}[:.]\d{2}\b|после|до)/.test(t)) return true;
  }
  if (fields.includes('photos') && /(фото|изображен|\[photo\]|позже|потом|пришлю)/.test(t)) return true;
  if (fields.includes('channels') && /(авито|суточн|остров|яндекс|airbnb|booking|букинг|канал|площадк|ota)/.test(t)) return true;
  return false;
}

export function isGuestSelfDeclaration(messageText: string): boolean {
  const t = text(messageText).toLowerCase();
  return /^я\s+гость$/i.test(text(messageText)) || /я\s+гость/.test(t) || /^гость(?:\s|$|[,.!?;:])/i.test(t);
}

export function isOwnerSelfDeclaration(messageText: string): boolean {
  const t = text(messageText).toLowerCase();
  return (
    /^я\s+владелец\/управляющий$/i.test(text(messageText)) ||
    /я\s+владелец/.test(t) ||
    /я\s+управляющ/.test(t)
  );
}

function isObjectProblemButton(messageText: string): boolean {
  return /^проблема\s+по\s+объекту$/i.test(text(messageText));
}

export function shouldSavePendingIdentityMessage(messageText: string): boolean {
  const normalized = text(messageText);
  if (!normalized) return false;
  if (normalized.startsWith('/')) return false;
  if (IDENTITY_SELECTION_TEXTS.has(normalized)) return false;
  if (isGuestSelfDeclaration(normalized) || isOwnerSelfDeclaration(normalized)) return false;
  return true;
}

function isIdentityEstablished(params: {
  envelope: InboundMessageEnvelope;
  identity: IdentityResolution;
  rememberedIdentity?: SenderIdentity | null;
  crmRole: string;
  guestSelfDeclared: boolean;
  ownerSelfDeclared: boolean;
}): boolean {
  if (metadataIdentity(params.envelope)) return true;
  if (hasTelegramTestMode(params.envelope)) return true;
  if (params.rememberedIdentity) return true;
  if (params.guestSelfDeclared || params.ownerSelfDeclared) return true;
  if (params.crmRole === 'owner' || params.crmRole === 'manager') return true;
  const boundIdentity = identityFromBinding(params.identity);
  if (boundIdentity && params.identity.status === 'resolved') return true;
  return false;
}

function metadataIdentity(envelope: InboundMessageEnvelope): SenderIdentity | null {
  const value = norm(envelope.metadata?.senderIdentity ?? envelope.metadata?.sender_identity ?? envelope.metadata?.role);
  if (value === 'guest') return 'guest';
  if (value === 'owner') return 'owner';
  if (value === 'owner_manager') return 'owner';
  if (value === 'manager') return 'manager';
  if (value === 'lead') return 'lead';
  if (value === 'support_problem' || value === 'support/problem') return 'support_problem';
  if (value === 'test_guest') return 'test_guest';
  if (value === 'internal_operator' || value === 'operator') return 'internal_operator';
  return null;
}

function identityFromBinding(identity: IdentityResolution): SenderIdentity | null {
  if (identity.role === 'guest') return 'guest';
  if (identity.role === 'test_guest') return 'test_guest';
  if (identity.role === 'owner') return 'owner';
  if (identity.role === 'manager') return 'manager';
  if (identity.role === 'lead') return 'lead';
  if (identity.role === 'operator') return 'internal_operator';
  return null;
}

function telegramUsername(envelope: InboundMessageEnvelope): string {
  return norm(
    envelope.metadata?.telegram_username ??
      envelope.metadata?.telegramUsername ??
      (envelope.metadata as any)?.telegram?.username,
  );
}

function telegramDisplayName(envelope: InboundMessageEnvelope): string {
  const firstName = text(envelope.metadata?.telegram_first_name ?? (envelope.metadata as any)?.telegram?.first_name);
  const username = telegramUsername(envelope);
  return firstName || (username ? `@${username}` : 'Контакт из Telegram');
}

async function findCrmContactByTelegramUsername(username: string): Promise<{ id: string; role?: string | null } | null> {
  if (!username) return null;
  try {
    const { data, error } = await supabase
      .from('crm_contacts')
      .select('id,role')
      .eq('telegram_username', username)
      .maybeSingle();
    if (error || !data) return null;
    return data as { id: string; role?: string | null };
  } catch {
    return null;
  }
}

async function createLeadIfSafe(envelope: InboundMessageEnvelope): Promise<string | undefined> {
  const username = telegramUsername(envelope);
  if (!username) return undefined;

  const existing = await findCrmContactByTelegramUsername(username);
  if (existing?.id) return existing.id;

  try {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('crm_contacts')
      .insert({
        name: telegramDisplayName(envelope),
        phone: null,
        contact: username,
        telegram_username: username,
        email: null,
        role: 'unknown',
        source: 'telegram',
        property_count: 0,
        city: null,
        notes: 'Первое обращение в Telegram с интересом к подключению ASI.',
        status: 'new_lead',
        communication_status: 'wrote_first',
        last_activity_at: now,
        next_action: 'Уточнить город, тип объекта и количество объектов.',
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

export async function resolveCommunicationIdentityRoute(params: {
  envelope: InboundMessageEnvelope;
  identity: IdentityResolution;
  rememberedIdentity?: SenderIdentity | null;
}): Promise<CommunicationIdentityRoutingDecision> {
  const { envelope, identity } = params;
  const messageText = text(envelope.messageText);
  const metaIdentity = metadataIdentity(envelope);
  const boundIdentity = identityFromBinding(identity);
  const crmByUsername = await findCrmContactByTelegramUsername(telegramUsername(envelope));
  const crmRole = norm(crmByUsername?.role);
  const guestSelfDeclared = isGuestSelfDeclaration(messageText);
  const ownerSelfDeclared = isOwnerSelfDeclaration(messageText);
  const objectProblemButton = isObjectProblemButton(messageText);
  const onboarding = activeOwnerOnboarding(envelope);
  const intentRoute = classifyGuestCommunicationIntent({
    messageText,
    currentIdentity: onboarding.active ? onboarding.senderIdentity : undefined,
  });

  if (!metaIdentity && !boundIdentity && !crmRole && !params.rememberedIdentity && !onboarding.active) {
    if (intentRoute.detectedIntent === 'lead_connection' && intentRoute.confidence >= 0.85) {
      const crmContactId = crmByUsername?.id ?? (await createLeadIfSafe(envelope));
      return {
        senderIdentity: 'lead',
        route: 'lead',
        shouldRunGuestConcierge: false,
        replyText: LEAD_REPLY_RU,
        selectedIdentity: 'lead',
        crmContactId,
        reason: crmContactId ? 'lead_intent_first_crm_linked' : 'lead_intent_first_no_safe_crm_key',
        audit: {
          crmContactId: crmContactId ?? null,
          telegramUsername: telegramUsername(envelope) || null,
          detectedIntent: intentRoute.detectedIntent,
          confidence: intentRoute.confidence,
        },
      };
    }
  }

  if (!metaIdentity && !boundIdentity && !crmRole && objectProblemButton) {
    return {
      senderIdentity: 'unknown',
      route: 'object_problem_clarify',
      shouldRunGuestConcierge: false,
      replyText: PROBLEM_IDENTITY_CLARIFY_RU,
      replyMarkup: PROBLEM_IDENTITY_REPLY_KEYBOARD,
      reason: 'object_problem_needs_role',
      audit: { identityStatus: identity.status, identityReason: identity.reason },
    };
  }

  if (
    !isIdentityEstablished({
      envelope,
      identity,
      rememberedIdentity: params.rememberedIdentity,
      crmRole,
      guestSelfDeclared,
      ownerSelfDeclared,
    })
    && !onboarding.active
  ) {
    return {
      senderIdentity: 'unknown',
      route: 'unknown_clarify',
      shouldRunGuestConcierge: false,
      replyText: UNKNOWN_IDENTITY_CLARIFY_RU,
      replyMarkup: UNKNOWN_IDENTITY_INLINE_KEYBOARD,
      reason: 'unknown_sender_needs_role',
      audit: { identityStatus: identity.status, identityReason: identity.reason },
    };
  }

  let senderIdentity: SenderIdentity =
    metaIdentity ??
    (hasTelegramTestMode(envelope) ? 'test_guest' : null) ??
    (ownerSelfDeclared ? 'owner' : null) ??
    (crmRole === 'owner' ? 'owner' : crmRole === 'manager' ? 'manager' : null) ??
    (guestSelfDeclared && !onboarding.active ? 'guest' : null) ??
    params.rememberedIdentity ??
    onboarding.senderIdentity ??
    boundIdentity ??
    (isLeadIntent(messageText) ? 'lead' : 'unknown');

  if (
    !metaIdentity &&
    !guestSelfDeclared &&
    senderIdentity === 'guest' &&
    identity.status !== 'resolved' &&
    !hasTelegramTestMode(envelope)
  ) {
    senderIdentity = isLeadIntent(messageText) ? 'lead' : 'unknown';
  }

  const currentIntentRoute = classifyGuestCommunicationIntent({
    messageText,
    currentIdentity: senderIdentity,
  });

  if (
    !metaIdentity &&
    (senderIdentity === 'owner' || senderIdentity === 'manager') &&
    isGuestConciergeIntent(currentIntentRoute.detectedIntent) &&
    currentIntentRoute.shouldAskRoleConfirmation &&
    (!onboarding.active || !looksLikeOwnerOnboardingContinuation(messageText, onboarding.missing))
  ) {
    return {
      senderIdentity,
      route: 'role_conflict_guest_question',
      shouldRunGuestConcierge: false,
      replyText: onboarding.active ? ONBOARDING_SCENARIO_SWITCH_CONFIRM_RU : ROLE_CONFLICT_GUEST_QUESTION_RU,
      replyMarkup: ROLE_CONFLICT_GUEST_INLINE_KEYBOARD,
      reason: currentIntentRoute.reason,
      audit: {
        crmContactId: crmByUsername?.id ?? null,
        detectedIntent: currentIntentRoute.detectedIntent,
        confidence: currentIntentRoute.confidence,
        roleConflict: currentIntentRoute.roleConflict,
      },
    };
  }

  if (
    !metaIdentity &&
    onboarding.active &&
    senderIdentity === 'lead' &&
    isGuestConciergeIntent(currentIntentRoute.detectedIntent) &&
    currentIntentRoute.shouldAskRoleConfirmation &&
    !looksLikeOwnerOnboardingContinuation(messageText, onboarding.missing)
  ) {
    return {
      senderIdentity,
      route: 'role_conflict_guest_question',
      shouldRunGuestConcierge: false,
      replyText: ONBOARDING_SCENARIO_SWITCH_CONFIRM_RU,
      replyMarkup: ROLE_CONFLICT_GUEST_INLINE_KEYBOARD,
      reason: currentIntentRoute.reason,
      audit: {
        crmContactId: crmByUsername?.id ?? null,
        detectedIntent: currentIntentRoute.detectedIntent,
        confidence: currentIntentRoute.confidence,
        roleConflict: currentIntentRoute.roleConflict,
        activeOwnerOnboarding: true,
      },
    };
  }

  if (
    (senderIdentity === 'guest' || senderIdentity === 'test_guest') &&
    currentIntentRoute.detectedIntent === 'lead_connection'
  ) {
    const crmContactId = crmByUsername?.id ?? (await createLeadIfSafe(envelope));
    return {
      senderIdentity: 'lead',
      route: 'lead',
      shouldRunGuestConcierge: false,
      replyText: LEAD_REPLY_RU,
      selectedIdentity: 'lead',
      crmContactId,
      reason: crmContactId ? 'lead_intent_from_guest_crm_linked' : 'lead_intent_from_guest_no_safe_crm_key',
      audit: {
        crmContactId: crmContactId ?? null,
        telegramUsername: telegramUsername(envelope) || null,
        detectedIntent: currentIntentRoute.detectedIntent,
        previousIdentity: senderIdentity,
      },
    };
  }

  if (senderIdentity === 'guest' || senderIdentity === 'test_guest') {
    if (guestSelfDeclared && senderIdentity === 'guest') {
      return {
        senderIdentity,
        route: 'guest_selected',
        shouldRunGuestConcierge: false,
        replyText: GUEST_SELECTED_REPLY_RU,
        selectedIdentity: 'guest',
        reason: 'guest_self_selected',
        audit: { identityStatus: identity.status, identityReason: identity.reason },
      };
    }

    return {
      senderIdentity,
      route: 'guest_concierge',
      shouldRunGuestConcierge: true,
      reason: senderIdentity === 'test_guest' ? 'test_guest_route' : 'guest_identity_resolved',
      audit: { identityStatus: identity.status, identityReason: identity.reason },
    };
  }

  if (senderIdentity === 'owner' || senderIdentity === 'manager') {
    return {
      senderIdentity,
      route: 'owner_manager',
      shouldRunGuestConcierge: false,
      replyText: OWNER_MANAGER_REPLY_RU,
      selectedIdentity: senderIdentity,
      reason: `${senderIdentity}_route`,
      audit: { crmContactId: crmByUsername?.id ?? null },
    };
  }

  if (senderIdentity === 'internal_operator') {
    return {
      senderIdentity,
      route: 'internal_operator',
      shouldRunGuestConcierge: false,
      replyText: INTERNAL_OPERATOR_REPLY_RU,
      reason: 'internal_operator_route',
      audit: {},
    };
  }

  if (senderIdentity === 'support_problem') {
    return {
      senderIdentity,
      route: 'support_problem',
      shouldRunGuestConcierge: false,
      replyText: SUPPORT_PROBLEM_REPLY_RU,
      selectedIdentity: 'support_problem',
      reason: 'support_problem_selected',
      audit: { identityStatus: identity.status, identityReason: identity.reason },
    };
  }

  if (senderIdentity === 'lead') {
    const crmContactId = crmByUsername?.id ?? (await createLeadIfSafe(envelope));
    return {
      senderIdentity: 'lead',
      route: 'lead',
      shouldRunGuestConcierge: false,
      replyText: LEAD_REPLY_RU,
      selectedIdentity: 'lead',
      crmContactId,
      reason: crmContactId ? 'lead_intent_crm_linked' : 'lead_intent_no_safe_crm_key',
      audit: { crmContactId: crmContactId ?? null, telegramUsername: telegramUsername(envelope) || null },
    };
  }

  return {
    senderIdentity: 'unknown',
    route: 'unknown_clarify',
    shouldRunGuestConcierge: false,
    replyText: UNKNOWN_IDENTITY_CLARIFY_RU,
    replyMarkup: UNKNOWN_IDENTITY_INLINE_KEYBOARD,
    reason: 'unknown_sender_needs_role',
    audit: { identityStatus: identity.status, identityReason: identity.reason },
  };
}
