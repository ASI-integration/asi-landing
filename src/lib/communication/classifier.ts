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

export async function classifyMessage(text: string): Promise<ClassifyResult> {
  return classify(text);
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
        return 'Здравствуйте! Принято. Уточните объект, даты и имя гостя — всё передадим в guest operations.';
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
      return 'Got it! Share the property, dates, and guest name and this will go to guest operations.';
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

export const SYSTEM_PROMPT = `You are a high-intelligence operations assistant for a short-term rental (STR) management company.
You receive operational messages forwarded by staff via Telegram — these may include guest complaints, access issues, booking questions, or forwarded guest messages.

Rules for Hospitality Layer:
- Adapt tone to the guest's situation: welcoming for pre-arrival/pre-booking, urgent and empathetic for in-stay issues, appreciative for post-stay.
- Reply in the same language as the user message (English or Russian).
- Answer briefly for simple questions.
- Ask a targeted follow-up question if key identifiers (property, guest name) or details are missing.
- Avoid repetitive wording. Use warm, natural hospitality-style wording without sounding robotic.
- Do not claim actions were taken if they weren't.
- Do not hallucinate policies, facts, fees, or access details.
- Only answer based on the provided grounded knowledge. If knowledge is missing, explicitly say information is unavailable.
- Do not use bullet lists or headers — plain conversational text only.`;

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

export function buildIntelligentPrompt(
  context: CommunicationContext,
  text: string,
  classification: ClassifyResult,
  templateHints?: string | null,
  sessionContext?: string | null,
): string {
  const base = buildUserPrompt(text, classification);
  const langCode = classification.lang as LanguageCode || 'en';
  let dynamicSystemPrompt = formatLanguageFallbackPrompt(langCode, SYSTEM_PROMPT);
  const { intentResult, reservation, knowledge } = context;

  const lines = [
    base,
    sessionContext ? sessionContext : null,
    `--- Context Assembly ---`,
    `Detected Intent: ${intentResult.intent} (Confidence: ${intentResult.confidence})`,
    `Reservation Match: ${reservation.status} (\${reservation.guestName || 'Unknown Name'} @ \${reservation.propertyId || 'Unknown Property'})`,
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
  ].filter(Boolean) as string[];

  if (templateHints) {
    lines.push(`--- Property Templates ---`, templateHints);
  }

  lines.push(
    `--------------------------`,
    `Please respond to the guest or staff accordingly, keeping strict adherence to the grounded knowledge and tone policies.`,
  );

  return lines.join('\n');
}
