import type { CommunicationChannel } from './types';
import type { CommunicationAutopilotIntent } from './autopilot';
import {
  extractBookingIdFromTelegramText,
  extractPhoneFromTelegramText,
} from './telegram-guest-memory';

export type CommAgentRequestedIdentifier =
  | 'booking_reference'
  | 'phone'
  | 'address'
  | 'property_hint'
  | 'guest_name'
  | null;

export type CommAgentSessionMemoryV1 = {
  last_intent: CommunicationAutopilotIntent | string | null;
  last_requested_identifier: CommAgentRequestedIdentifier;
  last_known_booking_id: string | null;
  last_known_property_id: string | null;
  last_safe_reply: string | null;
  pending_operator_reason: string | null;
  last_message_at: string;
};

type MemoryStore = Map<string, CommAgentSessionMemoryV1>;

const sessionStore: MemoryStore = new Map();

export function commAgentSessionKey(channel: CommunicationChannel, sessionId: string | number): string {
  return `${channel}:${String(sessionId)}`;
}

export function getCommAgentSessionMemory(
  channel: CommunicationChannel,
  sessionId: string | number,
): CommAgentSessionMemoryV1 | null {
  return sessionStore.get(commAgentSessionKey(channel, sessionId)) ?? null;
}

export function updateCommAgentSessionMemory(
  channel: CommunicationChannel,
  sessionId: string | number,
  patch: Partial<CommAgentSessionMemoryV1>,
): CommAgentSessionMemoryV1 {
  const key = commAgentSessionKey(channel, sessionId);
  const prev = sessionStore.get(key);
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
    last_message_at: new Date().toISOString(),
  };
  sessionStore.set(key, next);
  return next;
}

export function clearCommAgentSessionMemory(channel: CommunicationChannel, sessionId: string | number): void {
  sessionStore.delete(commAgentSessionKey(channel, sessionId));
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
  if (/^(да|нет|ок|ok|спасибо|понял|понятно)$/i.test(normalized)) return false;
  return wordCount <= 6 && !/[?!]{2,}/.test(normalized);
}

function intentExpectsIdentifier(intent: string | null | undefined): CommAgentRequestedIdentifier {
  switch (intent) {
    case 'address_instruction':
    case 'wifi':
    case 'parking':
    case 'checkout':
    case 'early_checkin_late_checkout':
      return 'booking_reference';
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

  const matchesPending =
    (pendingId === 'booking_reference' && Boolean(bookingRef)) ||
    (pendingId === 'phone' && Boolean(phone)) ||
    (pendingId === 'address' && address) ||
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
  const prefix =
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
    detected_identifier: bookingRef ? 'booking_reference' : phone ? 'phone' : address ? 'address' : pendingId,
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
}): Partial<CommAgentSessionMemoryV1> {
  const needsContext = input.action === 'needs_context' || input.action === 'ask_clarification';
  const requested =
    needsContext && input.needsBookingLookup !== false
      ? intentExpectsIdentifier(input.intent)
      : null;

  return {
    last_intent: input.intent,
    last_requested_identifier: requested,
    last_known_booking_id: input.bookingId ?? null,
    last_known_property_id: input.propertyId ?? null,
    last_safe_reply: input.replyText?.slice(0, 500) ?? null,
    pending_operator_reason: input.needsOperator ? (input.escalationReason ?? input.intent) : null,
  };
}
