import {
  ClassifyResult,
  Lang,
  MessageCategory,
  MessageSlots,
} from './types';

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

export function classify(text: string, languageCode?: string): ClassifyResult {
  const normalized = (text || '').trim().toLowerCase();
  const isRuText = /[а-яё]/i.test(normalized);
  const lang: Lang = (isRuText || (normalized === '/start' && languageCode === 'ru')) ? 'ru' : 'en';
  const slots = extractSlots(normalized);

  if (!text) return { category: MessageCategory.Fallback, lang, slots };
  if (normalized === '/start') return { category: MessageCategory.Start, lang, slots };

  // ── Greeting: exact match OR sentence starts with keyword (punctuation-tolerant) ──
  const startsWithGreeting = (greetings: string[]) =>
    greetings.some(g => {
      if (normalized === g) return true;
      // Allow punctuation immediately after the keyword: "здравствуйте." / "hello,"
      return normalized.startsWith(g) &&
        (normalized.length === g.length || /[\s.,!?]/.test(normalized[g.length]));
    });

  // Only classify as Greeting if the message is SHORT (≤ 60 chars) — long
  // messages that open with a greeting are operational, not just hellos.
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
  // Catches messages like "Здравствуйте, мы заселяемся, где парковка?"
  // that have booking context spread across the sentence.
  if (hasBookingContext(normalized, slots)) {
    return { category: MessageCategory.Booking, lang, slots };
  }

  // ── True fallback: unclear intent, requires operator ─────────────────────
  return { category: MessageCategory.Fallback, lang, slots };
}

// ─── Deterministic Fallback Replies ──────────────────────────────────────────

export function deterministicReply(result: ClassifyResult): string {
  const { category, lang, slots } = result;

  if (lang === 'ru') {
    switch (category) {
      case MessageCategory.Start:
        return 'ASI online.\nОтправьте сообщение гостя, проблему или запрос.';
      case MessageCategory.Greeting:
        return 'Соединение работает.\nОтправьте сообщение гостя, проблему или запрос.';
      case MessageCategory.GuestMessage:
        return 'Понял. Отправьте точный текст сообщения от гостя — разберём и направим дальше.';
      case MessageCategory.Issue:
        return slots.isAccessRelated && slots.isUrgent
          ? 'Понял, похоже на проблему с доступом. Укажите объект и время заезда гостя — передадим в нужный поток.'
          : 'Понял. Опишите проблему подробнее — передадим в incident handling flow.';
      case MessageCategory.Booking:
        return 'Понял. Укажите объект, даты и гостя — передадим в guest operations flow.';
      default:
        return 'Получено. Тип запроса пока не определён — передаём на ручную проверку.';
    }
  }

  switch (category) {
    case MessageCategory.Start:
      return 'ASI online.\nSend a guest message, issue, or request.';
    case MessageCategory.Greeting:
      return 'Connection is working.\nSend a guest message, issue, or request.';
    case MessageCategory.GuestMessage:
      return "Got it. Share the exact guest message and I'll help route or draft a reply.";
    case MessageCategory.Issue:
      return slots.isAccessRelated && slots.isUrgent
        ? 'Understood — looks like an urgent access issue. Send the property/unit and check-in time so this can be escalated.'
        : 'Got it. Describe the issue in more detail and it will be routed to incident handling.';
    case MessageCategory.Booking:
      return 'Got it. Share the property, dates, and guest name and this will go to guest operations.';
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

export const SYSTEM_PROMPT = `You are an operations assistant for a short-term rental (STR) management company.
You receive operational messages forwarded by staff via Telegram — these may include guest complaints, access issues, booking questions, or forwarded guest messages.

Rules:
- Reply in the same language as the user message (English or Russian)
- Be concise: 1–3 short sentences max
- Sound human and operational, not robotic
- Do not claim actions were taken if they weren't
- Do not hallucinate missing details
- If key information is missing (property, time, guest name), ask for the single most important missing item
- Do not use bullet lists or headers — plain conversational text only`;

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
