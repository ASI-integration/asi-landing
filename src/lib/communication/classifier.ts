import {
  ClassifyResult,
  Lang,
  MessageCategory,
  MessageSlots,
  CommunicationContext,
  LanguageCode
} from './types';
import { detectLanguage, formatLanguageFallbackPrompt } from './language';

// ─── Slot Extraction ──────────────────────────────────────────────────────────

export function extractSlots(normalized: string): MessageSlots {
  return {
    isUrgent: [
      'urgent', 'emergency', 'asap', 'right now', 'immediately',
      'срочно', 'быстро', 'немедленно', 'экстренно',
    ].some(t => normalized.includes(t)),

    isAccessRelated: [
      'access', 'lock', 'door', 'code', 'key', 'entry', 'enter', 'get in', 'get inside',
      'замок', 'дверь', 'код', 'доступ', 'попасть', 'войти', 'ключ', 'открыть', 'внутрь',
    ].some(t => normalized.includes(t)),

    mentionsGuest: [
      'guest', 'tenant', 'client', 'visitor',
      'гость', 'клиент', 'жилец', 'гостя', 'гостей', 'гости', 'постоялец',
    ].some(t => normalized.includes(t)),

    mentionsTime: [
      'time', 'check-in', 'checkout', 'check in', 'check out', 'arrive', 'arrival',
      'tonight', 'today', 'tomorrow', 'after', 'before', 'pm', 'am', 'hour', 'late',
      'время', 'заезд', 'выезд', 'прибытие', 'сегодня', 'завтра', 'после', 'ночи',
      'вечер', 'утром', 'часов',
    ].some(t => normalized.includes(t)),

    mentionsObject: [
      'object', 'unit', 'apartment', 'room', 'property', 'flat', 'suite', 'building', 'parking',
      'объект', 'квартира', 'комната', 'апартамент', 'апартаменты', 'здание', 'корпус',
      'парковка', 'паркинг', 'место',
    ].some(t => normalized.includes(t)),
  };
}

export const emptySlots: MessageSlots = {
  isUrgent: false,
  isAccessRelated: false,
  mentionsGuest: false,
  mentionsTime: false,
  mentionsObject: false,
};

// ─── Keyword Banks ────────────────────────────────────────────────────────────

/** Greeting: only exact single-word OR sentence-start prefix (punctuation-tolerant). */
const GREETINGS_EN = ['hi', 'hello', 'hey', 'test', 'ping'];
const GREETINGS_RU = ['привет', 'здравствуйте', 'добрый день', 'добрый вечер', 'доброе утро', 'тест', 'пинг'];

/** Forwarded-guest-message intro phrases. */
const GUEST_FWD_EN = ['guest says', 'client says', 'message from guest', 'guest wrote', 'tenant says', 'forwarded from guest'];
const GUEST_FWD_RU = ['гость пишет', 'гость сказал', 'сообщение от гостя', 'клиент пишет', 'пересылаю от гостя'];

/** Operational issue signals. */
const ISSUE_EN = ['problem', 'issue', 'broken', 'not working', 'doesn\'t work', 'error', 'urgent', 'complaint', 'noise', 'water leak', 'electricity', 'lock failed', 'out of order'];
const ISSUE_RU = ['не работает', 'проблема', 'ошибка', 'сломалось', 'сломан', 'срочно', 'жалоба', 'шум', 'вода', 'протечка', 'свет', 'электричество', 'не открывается'];

/**
 * Booking / check-in / access signals — intentionally broad.
 * Covers multi-intent messages that mention any aspect of a stay.
 */
const BOOKING_EN = [
  'check-in', 'check in', 'checkout', 'check-out', 'check out',
  'code', 'access', 'lock', 'door', 'key',
  'reservation', 'booking', 'booked', 'book',
  'arrive', 'arrival', 'arriving', 'leaving',
  'parking', 'park', 'garage',
  'how to get in', 'get inside', 'enter', 'entry',
  'tonight', 'late arrival', 'after midnight',
];
const BOOKING_RU = [
  'заезд', 'выезд', 'заселен', 'заселяемся', 'заселение', 'выселение',
  'код', 'доступ', 'замок', 'дверь', 'ключ', 'открыть',
  'бронь', 'бронирование', 'забронировано',
  'парковка', 'паркинг', 'машина',
  'попасть', 'войти', 'как попасть', 'как войти', 'внутрь',
  'после', 'ночи', 'вечером', 'сегодня заедем', 'поздно',
  'гостей', 'гостя', // "2 гостя" → booking context
];

// ─── Scoring helpers ──────────────────────────────────────────────────────────

function countMatches(normalized: string, keywords: string[]): number {
  return keywords.filter(k => normalized.includes(k)).length;
}

/**
 * Returns true when a message bears multiple operational signals typical of a
 * guest operational inquiry — even if no single keyword bank fires outright.
 *
 * Promotes messages to Booking when they have:
 *   ≥1 booking/access keyword  AND  ≥1 object/time/guest slot
 * This prevents multi-intent guest messages from falling to Fallback.
 */
function hasBookingContext(normalized: string, slots: MessageSlots): boolean {
  const bookingHits =
    countMatches(normalized, BOOKING_EN) +
    countMatches(normalized, BOOKING_RU);

  if (bookingHits === 0) return false;

  // At least one secondary signal must also be present
  const secondarySignals = [
    slots.mentionsObject,
    slots.mentionsTime,
    slots.mentionsGuest,
    slots.isAccessRelated,
  ].filter(Boolean).length;

  return secondarySignals >= 1;
}

// ─── Deterministic Classifier ─────────────────────────────────────────────────

/** Synchronous classifier. Pass an optional `langOverride` (e.g. from Telegram's
 *  `language_code`) to force the `lang` field without affecting category detection. */
export function classify(text: string, langOverride?: string): ClassifyResult {
  const normalized = text.toLowerCase().trim();
  const detectedLang = detectLanguage(text).detectedLanguage;
  const lang: Lang = (langOverride as Lang) ?? detectedLang;

  if (!normalized) {
    return { category: MessageCategory.Fallback, lang, slots: { ...emptySlots } };
  }

  const slots = extractSlots(normalized);

  if (normalized === '/start') return { category: MessageCategory.Start, lang, slots };

  // ── Greeting: exact match OR sentence starts with keyword (punctuation-tolerant) ──
  const startsWithGreeting = (greetings: string[]) =>
    greetings.some(g => {
      if (normalized === g) return true;
      return normalized.startsWith(g) &&
        (normalized.length === g.length || /[\s.,!?]/.test(normalized[g.length]));
    });

  // Only classify as Greeting if the message is SHORT (≤ 60 chars)
  if (normalized.length <= 60 && startsWithGreeting([...GREETINGS_EN, ...GREETINGS_RU])) {
    return { category: MessageCategory.Greeting, lang, slots };
  }

  // ── Forwarded guest message ───────────────────────────────────────────────
  if (GUEST_FWD_EN.some(t => normalized.includes(t)) ||
      GUEST_FWD_RU.some(t => normalized.includes(t))) {
    return { category: MessageCategory.GuestMessage, lang, slots };
  }

  // ── Operational issue ─────────────────────────────────────────────────────
  if (ISSUE_EN.some(t => normalized.includes(t)) ||
      ISSUE_RU.some(t => normalized.includes(t))) {
    return { category: MessageCategory.Issue, lang, slots };
  }

  // ── Booking / check-in / access (single-keyword match) ───────────────────
  if (BOOKING_EN.some(t => normalized.includes(t)) ||
      BOOKING_RU.some(t => normalized.includes(t))) {
    return { category: MessageCategory.Booking, lang, slots };
  }

  // ── Multi-signal promotion: operational guest inquiry without exact keyword ─
  if (hasBookingContext(normalized, slots)) {
    return { category: MessageCategory.Booking, lang, slots };
  }

  // ── True fallback ─────────────────────────────────────────────────────────
  return { category: MessageCategory.Fallback, lang, slots };
}

/**
 * Async wrapper around the synchronous `classify`. Accepts an optional raw
 * language code from the channel provider (e.g. Telegram `from.language_code`)
 * and sanitises it before passing to `classify` as a lang override.
 *
 * Supported codes: zh | en | es | ar | fr | de | ru
 * BCP-47 sub-tags (e.g. 'ru-RU') are trimmed to the 2-letter base.
 */
const SUPPORTED_LANGS_ARR: Lang[] = ['zh', 'en', 'es', 'ar', 'fr', 'de', 'ru'];
export async function classifyMessage(text: string, rawLangCode?: string): Promise<ClassifyResult> {
  const base = rawLangCode?.split('-')[0]?.toLowerCase();
  const langOverride = base && SUPPORTED_LANGS_ARR.includes(base as Lang) ? base : undefined;
  return classify(text, langOverride);
}

// ─── Deterministic Fallback Replies ──────────────────────────────────────────

export function deterministicReply(result: ClassifyResult): string {
  const { category, lang, slots } = result;

  if (lang === 'ru') {
    switch (category) {
      case MessageCategory.Start:
        return 'ASI online.\nОтправьте сообщение гостя, проблему или запрос.';
      case MessageCategory.Greeting:
        return 'Здравствуйте! Чем могу помочь? Отправьте запрос гостя, проблему или детали заезда.';
      case MessageCategory.GuestMessage:
        return 'Здравствуйте! Получили сообщение. Пришлите точный текст от гостя — разберём и поможем с ответом.';
      case MessageCategory.Issue:
        return slots.isAccessRelated && slots.isUrgent
          ? 'Здравствуйте! Похоже на срочную проблему с доступом. Укажите объект и время заезда — передадим немедленно.'
          : 'Здравствуйте! Получили информацию о проблеме. Опишите подробнее — передадим в нужный поток.';
      case MessageCategory.Booking:
        return 'Здравствуйте! Принято. Уточню только недостающие данные по брони (объект, даты, имя гостя) и передам в guest operations.';
      default:
        return 'Получено. Тип запроса пока не определён — передаём на ручную проверку.';
    }
  }

  switch (category) {
    case MessageCategory.Start:
      return 'ASI online.\nSend a guest message, issue, or request.';
    case MessageCategory.Greeting:
      return 'Hi! How can I help? Send a guest message, issue, or check-in details.';
    case MessageCategory.GuestMessage:
      return "Got it. Share the exact guest message and I'll help route or draft a reply.";
    case MessageCategory.Issue:
      return slots.isAccessRelated && slots.isUrgent
        ? 'On it — urgent access issue noted. Send the property and check-in time to escalate.'
        : 'Got it. Describe the issue in more detail and it will be routed to incident handling.';
    case MessageCategory.Booking:
      return 'Got it. I will ask only for missing booking details (property, dates, guest name) and route it to guest operations.';
    default:
      return 'Received. Message type is unclear — passing to manual review.';
  }
}

// ─── LLM-eligible categories ─────────────────────────────────────────────────

export const LLM_CATEGORIES: MessageCategory[] = [
  MessageCategory.GuestMessage,
  MessageCategory.Issue,
  MessageCategory.Booking,
  MessageCategory.Fallback,
];

// ─── LLM prompt helpers ───────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `Role: You are the intelligent concierge assistant of ASI (Automated Service Integration).
Goal: automate short-term-rental operations as close to 99% as possible.

CRITICAL RULE BEFORE ASKING ANY FOLLOW-UP QUESTION:
- First analyze the current message and provided context for these entities:
  1) Property (address or listing name)
  2) Dates (check-in, check-out, or number of nights)
  3) Guest name
  4) Specific requests (parking, extra bed, pets)
- If an entity is already present, NEVER ask for it again.
- Confirm captured entities briefly in the reply (example pattern: "Accepted booking for <property> for <nights> nights").
- Ask only for truly missing information.

Knowledge and escalation rules:
- If the guest asks about details like parking, restaurants, extra amenities, or access instructions, answer strictly from grounded property knowledge.
- If relevant knowledge is unavailable, say that the information is currently unavailable and that you will уточнить у guest operations. Do this only after confirming already-known booking parameters.

Communication rules:
- Reply in the same language as the user message.
- Tone: professional, concise, efficient. No fluff, no excessive apologies.
- Keep responses short for simple asks.
- Do not claim actions were taken if they were not.
- Do not hallucinate policies, facts, fees, access details, or booking terms.
- Use plain conversational text only (no bullet lists or headers in the final user-facing reply).`;

export function buildSystemPrompt(langCode: LanguageCode = 'en'): string {
  return formatLanguageFallbackPrompt(langCode, SYSTEM_PROMPT);
}

export function buildUserPrompt(text: string, result: ClassifyResult): string {
  const { category, lang, slots } = result;
  const slotSummary = [
    slots.isUrgent && 'urgency: high',
    slots.isAccessRelated && 'access-related: yes',
    slots.mentionsGuest && 'mentions guest: yes',
    slots.mentionsTime && 'mentions time: yes',
    slots.mentionsObject && 'mentions property/unit: yes',
  ].filter(Boolean).join(', ') || 'no specific signals';

  return [
    `Detected category: ${category}`,
    `Language: ${lang}`,
    `Signals: ${slotSummary}`,
    ``,
    `Original message:`,
    text,
  ].join('\n');
}

export function buildIntelligentPrompt(context: CommunicationContext, text: string, classification: ClassifyResult): string {
  const base = buildUserPrompt(text, classification);
  const { intentResult, reservation, knowledge } = context;
  const knownGuest = reservation.guestName || context.memory.guestName || context.memory.bookingDraft?.guestName || 'N/A';
  const knownProperty = context.memory.bookingDraft?.propertyLabel || reservation.propertyId || 'N/A';
  const matchedPropertyId = reservation.propertyId || 'N/A';
  const knownStayNights = context.memory.bookingDraft?.stayNights ?? 'N/A';
  const knownSpecificRequests = context.memory.bookingDraft?.specificRequests?.join(', ') || 'N/A';
  const recentContext = context.recentMessages.length > 0
    ? context.recentMessages.slice(-5).map((m) => `[${m.role}] ${m.content}`).join(' | ')
    : 'N/A';
  
  return [
    base,
    `--- Context Assembly ---`,
    `Detected Intent: ${intentResult.intent} (Confidence: ${intentResult.confidence})`,
    `Reservation Match: ${reservation.status} (${knownGuest} @ ${knownProperty})`,
    `Known Guest Name: ${knownGuest}`,
    `Known Property: ${knownProperty}`,
    `Matched Property ID: ${matchedPropertyId}`,
    `Known Stay Duration Nights: ${knownStayNights}`,
    `Known Specific Requests: ${knownSpecificRequests}`,
    `Recent Conversation Context: ${recentContext}`,
    `--- Grounded Knowledge ---`,
    `Universal Policy: ${knowledge.universalPolicy}`,
    `Property Policy: ${knowledge.propertyPolicy || 'N/A'}`,
    `House Rules: ${knowledge.houseRules || 'N/A'}`,
    `Check-in: ${knowledge.checkInInstructions || 'N/A'}`,
    `Check-out: ${knowledge.checkOutInstructions || 'N/A'}`,
    `WiFi: ${knowledge.wifiInstructions || 'N/A'}`,
    `Parking: ${knowledge.parkingInstructions || 'N/A'}`,
    `Payment: ${knowledge.paymentRules || 'N/A'}`,
    `Upsells: ${knowledge.upsells || 'N/A'}`,
    `Emergency Contacts: ${knowledge.emergencyContacts || 'N/A'}`,
    `--------------------------`,
    `Please respond to the guest or staff accordingly, keeping strict adherence to the grounded knowledge and tone policies.`
  ].join('\n');
}
