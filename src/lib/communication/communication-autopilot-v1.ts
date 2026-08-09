import type { GroundedKnowledge } from './types';
import type { TelegramPropertyObjectV1 } from './telegram-booking-object-memory';
import {
  AUTOPILOT_MISSING_KNOWLEDGE_REPLY_RU,
  classifyKnowledgeTopic,
  requiresAutopilotOperatorEscalation,
  resolveKnowledgeAnswer,
  type KnowledgeTopic,
} from './knowledge-resolver';
import type { CommunicationAutopilotSessionMemory } from './communication-autopilot-session';
import { COMMUNICATION_AUTOPILOT_SESSION_TTL_MS } from './communication-autopilot-session';
import {
  resolveLanguageWithGuestMemory,
  type RelevantGuestMemoryContext,
} from './guest-long-term-memory';

export type CommunicationAutopilotV1Action = 'auto_reply' | 'clarification' | 'operator_handoff';

export type CommunicationAutopilotV1Result = {
  action: CommunicationAutopilotV1Action;
  replyText: string;
  topic: KnowledgeTopic;
  intent: string;
  needsOperator: boolean;
  resolved: boolean;
  missingFields: string[];
  escalationReason?: string;
  knowledgeSource?: string | null;
  language: 'ru' | 'en';
  memoryUsed: boolean;
  requestedMissingField?: string | null;
  unresolvedAction?: string | null;
  safetyBlockedAction?: boolean;
};

function handoffReply(language: 'ru' | 'en'): string {
  return language === 'en'
    ? 'I have passed this to an operator for review. Their answer will appear here after they check the situation.'
    : 'Передала вопрос оператору на проверку. Ответ появится здесь после того, как оператор разберётся в ситуации.';
}

function clarificationReply(language: 'ru' | 'en', field: 'booking_reference' | 'requested_time' | 'property_knowledge'): string {
  if (language === 'en') {
    if (field === 'booking_reference') return 'Please send your booking reference so I can safely check this information.';
    if (field === 'requested_time') return 'What exact time do you need?';
    return 'I do not have verified information for this property yet. I am asking the operator to clarify it.';
  }
  if (field === 'booking_reference') return 'Пришлите номер бронирования, чтобы я могла безопасно проверить информацию.';
  if (field === 'requested_time') return 'До какого точного времени вам нужно?';
  return AUTOPILOT_MISSING_KNOWLEDGE_REPLY_RU;
}

export function detectOperationalLanguage(
  messageText: string,
  previous?: CommunicationAutopilotSessionMemory | null,
): 'ru' | 'en' {
  const text = String(messageText ?? '').trim();
  if (/\b(?:switch|reply|speak)\s+(?:to|in)\s+english\b|\benglish please\b|(?:переключись|ответь|говори).*(?:на\s+)?английск/i.test(text)) return 'en';
  if (/\b(?:переключись|ответь|говори)\s+(?:на\s+)?русск/i.test(text)) return 'ru';
  if (
    previous?.language &&
    previous.requested_missing_field &&
    (/^(?=.{4,40}$)(?=.*\d)[A-ZА-Я0-9][A-ZА-Я0-9._/-]*$/i.test(text) ||
      /^(?:до\s+|к\s+|until\s+|at\s+)?(?:[01]?\d|2[0-3])(?::[0-5]\d)?$/i.test(text))
  ) {
    return previous.language;
  }
  if (/[А-Яа-яЁё]/.test(text)) return 'ru';
  if (/[A-Za-z]/.test(text)) return 'en';
  return previous?.language === 'en' ? 'en' : 'ru';
}

export function isExplicitOperationalLanguageSwitch(messageText: string): boolean {
  return /\b(?:switch|reply|speak)\s+(?:to|in)\s+(?:english|russian)\b|\b(?:english|russian) please\b|(?:переключись|ответь|говори).*(?:на\s+)?(?:английск|русск)/i.test(
    String(messageText ?? ''),
  );
}

function looksLikeBookingReference(text: string): boolean {
  const normalized = text.trim();
  return /^(?=.{4,40}$)(?=.*\d)[A-ZА-Я0-9][A-ZА-Я0-9._/-]*$/i.test(normalized);
}

function looksLikeTimeFragment(text: string): boolean {
  return /^(?:до\s+|until\s+|at\s+)?(?:[01]?\d|2[0-3])(?::[0-5]\d)?(?:\s*(?:час(?:а|ов)?|pm|am))?$/i.test(text.trim());
}

function continuationText(input: {
  messageText: string;
  session?: CommunicationAutopilotSessionMemory | null;
  language: 'ru' | 'en';
}): { text: string; memoryUsed: boolean } {
  const requested = input.session?.requested_missing_field;
  if (requested === 'booking_reference' && looksLikeBookingReference(input.messageText)) {
    const topic = input.session?.last_topic ?? input.session?.last_intent ?? 'previous request';
    return {
      text: input.language === 'en'
        ? `${topic} for booking ${input.messageText.trim()}`
        : `${topic} для бронирования ${input.messageText.trim()}`,
      memoryUsed: true,
    };
  }
  if (requested === 'requested_time' && looksLikeTimeFragment(input.messageText)) {
    const action = input.session?.unresolved_action;
    const prefix = action === 'early_checkin'
      ? (input.language === 'en' ? 'early check-in at' : 'ранний заезд к')
      : (input.language === 'en' ? 'late checkout until' : 'поздний выезд до');
    return { text: `${prefix} ${input.messageText.trim()}`, memoryUsed: true };
  }
  return { text: input.messageText, memoryUsed: false };
}

export function runCommunicationAutopilotV1(input: {
  messageText: string;
  property: TelegramPropertyObjectV1 | null;
  propertyId?: string | null;
  bookingVerified?: boolean;
  passport?: GroundedKnowledge | null;
  faq?: Record<string, string> | null;
  session?: CommunicationAutopilotSessionMemory | null;
  guestMemory?: RelevantGuestMemoryContext | null;
  language?: 'ru' | 'en';
}): CommunicationAutopilotV1Result {
  const messageText = String(input.messageText ?? '').trim();
  const detectedLanguage = input.language ?? detectOperationalLanguage(messageText, input.session);
  const language = resolveLanguageWithGuestMemory({
    messageText,
    detectedLanguage,
    memory: input.guestMemory,
  });
  if (isExplicitOperationalLanguageSwitch(messageText)) {
    return {
      action: 'auto_reply',
      replyText: language === 'en' ? 'I will continue in English.' : 'Продолжу на русском.',
      topic: 'unknown',
      intent: 'language_switch',
      needsOperator: false,
      resolved: true,
      missingFields: [],
      language,
      memoryUsed: Boolean(input.session?.language),
    };
  }
  const continuation = continuationText({ messageText, session: input.session, language });
  const relevantLongTermMemoryUsed = Boolean(
    input.guestMemory?.preferences.length ||
    input.guestMemory?.events.length ||
    (input.guestMemory?.preferredLanguage && input.guestMemory.preferredLanguage === language),
  );
  const memoryUsed = continuation.memoryUsed || relevantLongTermMemoryUsed;
  const effectiveMessageText = continuation.text;
  const escalation = requiresAutopilotOperatorEscalation(effectiveMessageText);
  if (escalation) {
    return {
      action: 'operator_handoff',
      replyText: handoffReply(language),
      topic: 'unknown',
      intent: escalation,
      needsOperator: true,
      resolved: false,
      missingFields: [],
      escalationReason: escalation,
      language,
      memoryUsed,
      unresolvedAction: escalation,
      safetyBlockedAction: true,
    };
  }

  const topic = classifyKnowledgeTopic(effectiveMessageText);
  if (topic === 'unknown') {
    return {
      action: 'operator_handoff',
      replyText: handoffReply(language),
      topic,
      intent: 'unclear_situation',
      needsOperator: true,
      resolved: false,
      missingFields: [],
      escalationReason: 'unclear_situation',
      language,
      memoryUsed,
      unresolvedAction: 'unclear_situation',
      safetyBlockedAction: true,
    };
  }

  if (topic === 'wifi' && !input.bookingVerified) {
    return {
      action: 'clarification',
      replyText: clarificationReply(language, 'booking_reference'),
      topic,
      intent: 'wifi',
      needsOperator: false,
      resolved: false,
      missingFields: ['booking.reference'],
      language,
      memoryUsed,
      requestedMissingField: 'booking_reference',
      unresolvedAction: 'wifi',
    };
  }

  const lateCheckout = topic === 'checkout_time' && /поздн|позже|до\s*\d|late\s+check|until\s*\d/i.test(effectiveMessageText);
  const earlyCheckin = topic === 'checkin_time' && /ранн|раньше|к\s*\d|early\s+check|at\s*\d/i.test(effectiveMessageText);
  if ((lateCheckout || earlyCheckin) && !looksLikeTimeFragment(messageText) && !continuation.memoryUsed) {
    const unresolvedAction = lateCheckout ? 'late_checkout' : 'early_checkin';
    return {
      action: 'clarification',
      replyText: clarificationReply(language, 'requested_time'),
      topic,
      intent: `${unresolvedAction}_request`,
      needsOperator: false,
      resolved: false,
      missingFields: ['requested_time'],
      language,
      memoryUsed: relevantLongTermMemoryUsed,
      requestedMissingField: 'requested_time',
      unresolvedAction,
    };
  }
  if ((lateCheckout || earlyCheckin) && continuation.memoryUsed) {
    const intent = lateCheckout ? 'late_checkout_request' : 'early_checkin_request';
    return {
      action: 'operator_handoff',
      replyText: handoffReply(language),
      topic,
      intent,
      needsOperator: true,
      resolved: false,
      missingFields: [],
      escalationReason: `${intent}_approval_required`,
      language,
      // A prior late-checkout event remains history only; approval is always
      // re-requested for the current stay through this operator handoff.
      memoryUsed: true,
      unresolvedAction: intent,
      safetyBlockedAction: true,
    };
  }

  const resolvedKnowledge = resolveKnowledgeAnswer({
    topic,
    messageText: effectiveMessageText,
    property: input.property,
    bookingVerified: Boolean(input.bookingVerified),
    passport: input.passport,
    faq: input.faq,
    language,
  });

  if (resolvedKnowledge.found && resolvedKnowledge.reply) {
    return {
      action: 'auto_reply',
      replyText: resolvedKnowledge.reply,
      topic,
      intent: topic,
      needsOperator: false,
      resolved: true,
      missingFields: [],
      knowledgeSource: resolvedKnowledge.source,
      language,
      memoryUsed,
    };
  }

  return {
    action: 'clarification',
    replyText: clarificationReply(language, 'property_knowledge'),
    topic,
    intent: topic,
    needsOperator: false,
    resolved: false,
    missingFields: resolvedKnowledge.missingFields,
    knowledgeSource: resolvedKnowledge.source,
    language,
    memoryUsed,
    requestedMissingField: 'property_knowledge',
    unresolvedAction: topic,
  };
}

export function buildAutopilotSessionPatch(input: {
  result: CommunicationAutopilotV1Result;
  messageText: string;
  propertyId?: string | null;
  propertyName?: string | null;
  previous?: CommunicationAutopilotSessionMemory | null;
  transport?: string | null;
  bookingReference?: string | null;
  now?: Date;
}): CommunicationAutopilotSessionMemory {
  const now = input.now ?? new Date();
  const summary = `${input.result.intent}:${input.result.action}; guest=${input.messageText}`
    .replace(/\s+/g, ' ')
    .slice(0, 500);
  const sensitiveReply = input.result.topic === 'wifi' || input.result.topic === 'keys' || input.result.topic === 'checkin_instructions';
  const inferredBookingReference = input.previous?.requested_missing_field === 'booking_reference' && looksLikeBookingReference(input.messageText)
    ? input.messageText.trim().slice(0, 40)
    : null;
  return {
    property_id: input.propertyId ?? input.previous?.property_id ?? null,
    object_name: input.propertyName ?? input.previous?.object_name ?? null,
    language: input.result.language,
    booking_reference:
      input.bookingReference ?? inferredBookingReference ?? input.previous?.booking_reference ?? null,
    last_topic: input.result.topic,
    last_intent: input.result.intent,
    requested_missing_field: input.result.resolved ? null : (input.result.requestedMissingField ?? null),
    unresolved_action: input.result.resolved ? null : (input.result.unresolvedAction ?? input.result.intent),
    pending_operator_reason: input.result.needsOperator
      ? (input.result.escalationReason ?? input.result.intent)
      : input.previous?.pending_operator_status === 'open'
        ? input.previous.pending_operator_reason ?? null
        : null,
    pending_operator_status: input.result.needsOperator
      ? 'open'
      : input.previous?.pending_operator_status ?? null,
    last_guest_question: input.messageText.slice(0, 240),
    last_reply: sensitiveReply ? `[verified ${input.result.topic} answer omitted]` : input.result.replyText.slice(0, 240),
    recent_summary: summary,
    last_transport: input.transport ?? input.previous?.last_transport ?? null,
    turn_count: Math.min(20, (input.previous?.turn_count ?? 0) + 1),
    updated_at: now.toISOString(),
    expires_at: new Date(now.getTime() + COMMUNICATION_AUTOPILOT_SESSION_TTL_MS).toISOString(),
  };
}
