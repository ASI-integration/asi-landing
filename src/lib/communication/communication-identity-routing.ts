import { supabase } from '@/lib/supabase';
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
  | 'object_problem_clarify'
  | 'internal_operator';

export type TelegramInlineKeyboardButton = {
  text: string;
  callback_data: string;
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
  'Здравствуйте! Подскажите, пожалуйста, кто вы — так я смогу ответить правильно:';

export const RESET_IDENTITY_CLARIFY_RU =
  'Идентичность и сессия сброшены. Подскажите, пожалуйста, кто вы — так я смогу ответить правильно:';

const IDENTITY_SELECTION_TEXTS = new Set([
  'Я гость по бронированию',
  'Я владелец / управляющий объекта',
  'Хочу подключить ASI',
  'Нужна поддержка',
  'Я гость',
  'Я владелец/управляющий',
]);

const PROBLEM_IDENTITY_CLARIFY_RU =
  'Проблема связана с вашим проживанием как гостя или с объектом, которым вы управляете?';

const GUEST_SELECTED_REPLY_RU =
  'Понял, вы гость по бронированию. Напишите вопрос по объекту — адрес, заезд, Wi-Fi, правила. Если бронь ещё не привязана, укажите номер бронирования или телефон из брони.';

const LEAD_REPLY_RU =
  'Отлично. Напишите, пожалуйста, сколько у вас объектов, в каком городе и через какие площадки вы сейчас принимаете бронирования. Я передам заявку на подключение ASI.';

const OWNER_MANAGER_REPLY_RU =
  'Понял, вы владелец/управляющий. Опишите, пожалуйста, объект или ситуацию, которую нужно разобрать. Я передам это как внутреннее обращение.';

const SUPPORT_PROBLEM_REPLY_RU =
  'Понял. Опишите, пожалуйста, что случилось. Если это связано с проживанием, укажите объект или бронь. Если это вопрос владельца/управляющего, напишите объект и ситуацию.';

const INTERNAL_OPERATOR_REPLY_RU =
  'Операторский контекст принят. Гостевой автопилот для этого сообщения не запущен.';

export const TELEGRAM_IDENTITY_CALLBACKS = {
  guest: 'identity:guest',
  ownerManager: 'identity:owner_manager',
  lead: 'identity:lead',
  supportProblem: 'identity:support_problem',
} as const;

export const UNKNOWN_IDENTITY_INLINE_KEYBOARD: TelegramInlineKeyboardMarkup = {
  inline_keyboard: [
    [
      { text: 'Я гость', callback_data: TELEGRAM_IDENTITY_CALLBACKS.guest },
      { text: 'Владелец/управляющий', callback_data: TELEGRAM_IDENTITY_CALLBACKS.ownerManager },
    ],
    [
      { text: 'Хочу подключить ASI', callback_data: TELEGRAM_IDENTITY_CALLBACKS.lead },
      { text: 'Нужна поддержка', callback_data: TELEGRAM_IDENTITY_CALLBACKS.supportProblem },
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
    /подключ|пилот|ранн(ий|его) доступ|автоматизац|сервис|демо|заявк/.test(t)
  );
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
  return firstName || (username ? `@${username}` : 'Telegram lead');
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
    (guestSelfDeclared ? 'guest' : null) ??
    params.rememberedIdentity ??
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
