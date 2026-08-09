import type { CommunicationChannel } from './types';
import type { CommunicationAutopilotIntent } from './autopilot';
import {
  extractBookingIdFromTelegramText,
  extractPhoneFromTelegramText,
} from './telegram-guest-memory';
import {
  loadAutonomousSession,
  patchAutonomousSessionCollectedData,
} from './conversation-session-store';

export type CommAgentRequestedIdentifier =
  | 'booking_reference'
  | 'phone'
  | 'address'
  | 'property_hint'
  | 'guest_name'
  | 'requested_time'
  | null;

export type CommAgentSessionMemoryV1 = {
  last_intent: CommunicationAutopilotIntent | string | null;
  last_requested_identifier: CommAgentRequestedIdentifier;
  last_known_booking_id: string | null;
  last_known_property_id: string | null;
  last_safe_reply: string | null;
  pending_operator_reason: string | null;
  pending_operator_status: 'open' | 'resolved' | null;
  language: 'ru' | 'en';
  unresolved_action: string | null;
  recent_summary: string | null;
  last_message_at: string;
  expires_at: string;
};

type MemoryStore = Map<string, CommAgentSessionMemoryV1>;

const sessionStore: MemoryStore = new Map();
const DURABLE_MEMORY_KEY = 'comm_agent_session_memory_v1';
export const COMM_AGENT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function numericChatId(sessionId: string | number): number | null {
  const parsed = Number(sessionId);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function isFresh(memory: CommAgentSessionMemoryV1): boolean {
  const expiresAt = Date.parse(String(memory.expires_at ?? ''));
  return Number.isFinite(expiresAt) && expiresAt > Date.now();
}

function loadDurableMemory(
  channel: CommunicationChannel,
  sessionId: string | number,
): CommAgentSessionMemoryV1 | null {
  const chatId = numericChatId(sessionId);
  if (chatId == null) return null;
  const raw = loadAutonomousSession(chatId)?.collected_data?.[DURABLE_MEMORY_KEY];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CommAgentSessionMemoryV1 & { session_key?: string };
    if (parsed.session_key !== commAgentSessionKey(channel, sessionId) || !isFresh(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function persistDurableMemory(
  channel: CommunicationChannel,
  sessionId: string | number,
  memory: CommAgentSessionMemoryV1,
): void {
  const chatId = numericChatId(sessionId);
  if (chatId == null) return;
  patchAutonomousSessionCollectedData({
    chatId,
    channel,
    set: {
      [DURABLE_MEMORY_KEY]: JSON.stringify({
        ...memory,
        session_key: commAgentSessionKey(channel, sessionId),
      }),
    },
  });
}

export function commAgentSessionKey(channel: CommunicationChannel, sessionId: string | number): string {
  return `${channel}:${String(sessionId)}`;
}

export function getCommAgentSessionMemory(
  channel: CommunicationChannel,
  sessionId: string | number,
): CommAgentSessionMemoryV1 | null {
  const key = commAgentSessionKey(channel, sessionId);
  const cached = sessionStore.get(key);
  if (cached && isFresh(cached)) return cached;
  const durable = loadDurableMemory(channel, sessionId);
  if (durable) sessionStore.set(key, durable);
  return durable;
}

export function updateCommAgentSessionMemory(
  channel: CommunicationChannel,
  sessionId: string | number,
  patch: Partial<CommAgentSessionMemoryV1>,
): CommAgentSessionMemoryV1 {
  const key = commAgentSessionKey(channel, sessionId);
  const prev = sessionStore.get(key) ?? loadDurableMemory(channel, sessionId);
  const now = new Date();
  const next: CommAgentSessionMemoryV1 = {
    last_intent: patch.last_intent !== undefined ? patch.last_intent : (prev?.last_intent ?? null),
    last_requested_identifier:
      patch.last_requested_identifier !== undefined
        ? patch.last_requested_identifier
        : (prev?.last_requested_identifier ?? null),
    last_known_booking_id:
      patch.last_known_booking_id !== undefined ? patch.last_known_booking_id : (prev?.last_known_booking_id ?? null),
    last_known_property_id:
      patch.last_known_property_id !== undefined ? patch.last_known_property_id : (prev?.last_known_property_id ?? null),
    last_safe_reply: patch.last_safe_reply !== undefined ? patch.last_safe_reply : (prev?.last_safe_reply ?? null),
    pending_operator_reason:
      patch.pending_operator_reason !== undefined
        ? patch.pending_operator_reason
        : (prev?.pending_operator_reason ?? null),
    pending_operator_status:
      patch.pending_operator_status !== undefined
        ? patch.pending_operator_status
        : (prev?.pending_operator_status ?? null),
    language: patch.language ?? prev?.language ?? 'ru',
    unresolved_action:
      patch.unresolved_action !== undefined ? patch.unresolved_action : (prev?.unresolved_action ?? null),
    recent_summary:
      patch.recent_summary !== undefined
        ? String(patch.recent_summary ?? '').trim().slice(0, 500) || null
        : (prev?.recent_summary ?? null),
    last_message_at: now.toISOString(),
    expires_at: new Date(now.getTime() + COMM_AGENT_SESSION_TTL_MS).toISOString(),
  };
  sessionStore.set(key, next);
  persistDurableMemory(channel, sessionId, next);
  return next;
}

export function clearCommAgentSessionMemory(channel: CommunicationChannel, sessionId: string | number): void {
  sessionStore.delete(commAgentSessionKey(channel, sessionId));
  const chatId = numericChatId(sessionId);
  if (chatId != null) {
    patchAutonomousSessionCollectedData({ chatId, channel, clear: [DURABLE_MEMORY_KEY] });
  }
}

/** Test-only: reset in-memory store. */
export function resetCommAgentSessionMemoryForTests(): void {
  sessionStore.clear();
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function looksLikeAddressFragment(text: string): boolean {
  const t = text.toLocaleLowerCase('ru-RU');
  if (t.length < 8) return false;
  return /(ул\.|улиц|просп|пер\.|дом\s*\d|кв\.|квартира|метро|район|набереж)/i.test(t);
}

function isLikelyFollowUpFragment(text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  if (normalized.length > 120) return false;
  const wordCount = normalized.split(/\s+/).length;
  if (wordCount > 12) return false;
  if (extractBookingIdFromTelegramText(normalized)) return true;
  if (extractPhoneFromTelegramText(normalized)) return true;
  if (looksLikeAddressFragment(normalized)) return true;
  if (/^(?:до\s+|к\s+|until\s+|at\s+)?(?:[01]?\d|2[0-3])(?::[0-5]\d)?$/i.test(normalized)) return true;
  if (/^(да|нет|ок|ok|спасибо|понял|понятно)$/i.test(normalized)) return false;
  return wordCount <= 6 && !/[?!]{2,}/.test(normalized);
}

function intentExpectsIdentifier(intent: string | null | undefined): CommAgentRequestedIdentifier {
  switch (intent) {
    case 'address_instruction':
    case 'wifi':
    case 'parking':
    case 'checkout':
      return 'booking_reference';
    case 'early_checkin_late_checkout':
      return 'requested_time';
    case 'check_in_access':
    case 'checkin_code_request':
    case 'booking_lookup_missing_details':
      return 'booking_reference';
    case 'booking_payment_support':
      return 'booking_reference';
    default:
      return null;
  }
}

export type CommAgentSessionContinuation = {
  memory_used: boolean;
  continued_intent: string | null;
  enriched_message_text: string;
  detected_identifier: CommAgentRequestedIdentifier;
};

/**
 * When the bot previously asked for booking/phone/address and the guest sends only that data,
 * continue the prior flow instead of treating the message as a new vague turn.
 */
export function applyCommAgentSessionContinuation(input: {
  channel: CommunicationChannel;
  sessionId: string | number;
  messageText: string;
  memory?: CommAgentSessionMemoryV1 | null;
}): CommAgentSessionContinuation {
  const memory = input.memory ?? getCommAgentSessionMemory(input.channel, input.sessionId);
  const text = normalizeText(input.messageText);
  if (!memory?.last_intent || !isLikelyFollowUpFragment(text)) {
    return {
      memory_used: false,
      continued_intent: null,
      enriched_message_text: input.messageText,
      detected_identifier: null,
    };
  }

  const pendingId = memory.last_requested_identifier ?? intentExpectsIdentifier(memory.last_intent);
  if (!pendingId) {
    return {
      memory_used: false,
      continued_intent: null,
      enriched_message_text: input.messageText,
      detected_identifier: null,
    };
  }

  const bookingRef = extractBookingIdFromTelegramText(text);
  const phone = extractPhoneFromTelegramText(text);
  const address = looksLikeAddressFragment(text);
  const requestedTime = /^(?:до\s+|к\s+|until\s+|at\s+)?(?:[01]?\d|2[0-3])(?::[0-5]\d)?$/i.test(text);

  const matchesPending =
    (pendingId === 'booking_reference' && Boolean(bookingRef)) ||
    (pendingId === 'phone' && Boolean(phone)) ||
    (pendingId === 'address' && address) ||
    (pendingId === 'requested_time' && requestedTime) ||
    (pendingId === 'property_hint' && (address || Boolean(bookingRef)));

  if (!matchesPending && !(bookingRef || phone)) {
    return {
      memory_used: false,
      continued_intent: null,
      enriched_message_text: input.messageText,
      detected_identifier: null,
    };
  }

  const intentLabel = String(memory.last_intent);
  const prefix = memory.language === 'en'
    ? intentLabel === 'wifi'
      ? 'wi-fi password'
      : intentLabel === 'parking'
        ? 'parking information'
        : intentLabel === 'address_instruction'
          ? 'directions'
          : intentLabel === 'checkout' || intentLabel === 'early_checkin_late_checkout'
            ? 'late checkout time'
            : intentLabel === 'check_in_access' || intentLabel === 'checkin_code_request'
              ? 'check-in and access'
              : intentLabel === 'booking_payment_support'
                ? 'booking and payment question'
                : 'previous request continuation'
    :
    intentLabel === 'wifi'
      ? 'пароль от wi-fi'
      : intentLabel === 'parking'
        ? 'где припарковать'
        : intentLabel === 'address_instruction'
          ? 'как добраться'
          : intentLabel === 'checkout' || intentLabel === 'early_checkin_late_checkout'
            ? 'время выезда'
            : intentLabel === 'check_in_access' || intentLabel === 'checkin_code_request'
              ? 'заселение и доступ'
              : intentLabel === 'booking_payment_support'
                ? 'вопрос по брони и оплате'
                : 'продолжение предыдущего вопроса';

  return {
    memory_used: true,
    continued_intent: intentLabel,
    enriched_message_text: `${prefix}: ${text}`,
    detected_identifier: bookingRef
      ? 'booking_reference'
      : phone
        ? 'phone'
        : address
          ? 'address'
          : requestedTime
            ? 'requested_time'
            : pendingId,
  };
}

export function deriveSessionMemoryPatchFromDecision(input: {
  intent: string;
  action: string;
  replyText?: string;
  needsBookingLookup?: boolean;
  needsOperator?: boolean;
  bookingId?: string | null;
  propertyId?: string | null;
  escalationReason?: string | null;
  language?: 'ru' | 'en';
  unresolvedAction?: string | null;
  recentSummary?: string | null;
}): Partial<CommAgentSessionMemoryV1> {
  const needsContext = input.action === 'needs_context' || input.action === 'ask_clarification';
  const requested =
    needsContext && input.needsBookingLookup !== false
      ? intentExpectsIdentifier(input.intent)
      : null;

  return {
    last_intent: input.intent,
    last_requested_identifier: requested,
    last_known_booking_id: input.bookingId ?? undefined,
    last_known_property_id: input.propertyId ?? undefined,
    last_safe_reply: input.replyText?.slice(0, 500) ?? null,
    pending_operator_reason: input.needsOperator ? (input.escalationReason ?? input.intent) : null,
    pending_operator_status: input.needsOperator ? 'open' : null,
    language: input.language,
    unresolved_action: needsContext || input.needsOperator ? (input.unresolvedAction ?? input.intent) : null,
    recent_summary: input.recentSummary,
  };
}
