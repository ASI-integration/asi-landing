import {
  ClassifyResult,
  Lang,
  MessageCategory,
  MessageSlots,
} from './types';

// ─── Slot Extraction ──────────────────────────────────────────────────────────

export function extractSlots(normalized: string): MessageSlots {
  return {
    isUrgent: ['urgent', 'emergency', 'asap', 'срочно', 'быстро'].some(t => normalized.includes(t)),
    isAccessRelated: ['access', 'lock', 'door', 'code', 'замок', 'дверь', 'код', 'доступ', 'попасть'].some(t => normalized.includes(t)),
    mentionsGuest: ['guest', 'tenant', 'client', 'гость', 'клиент', 'жилец'].some(t => normalized.includes(t)),
    mentionsTime: ['time', 'check-in', 'checkout', 'arrive', 'время', 'заезд', 'выезд', 'прибытие'].some(t => normalized.includes(t)),
    mentionsObject: ['object', 'unit', 'apartment', 'room', 'property', 'объект', 'квартира', 'комната', 'апартаменты'].some(t => normalized.includes(t)),
  };
}

// ─── Deterministic Classifier ─────────────────────────────────────────────────

export function classify(text: string, languageCode?: string): ClassifyResult {
  const normalized = (text || '').trim().toLowerCase();
  const isRuText = /[а-яё]/i.test(normalized);
  const lang: Lang = (isRuText || (normalized === '/start' && languageCode === 'ru')) ? 'ru' : 'en';
  const slots = extractSlots(normalized);

  if (!text) return { category: MessageCategory.Fallback, lang, slots };
  if (normalized === '/start') return { category: MessageCategory.Start, lang, slots };

  const greetingsEn = ['hi', 'hello', 'hey', 'test', 'ping'];
  const greetingsRu = ['привет', 'здравствуйте', 'тест', 'пинг'];
  if (
    greetingsEn.some(g => normalized === g || normalized.startsWith(g + ' ')) ||
    greetingsRu.some(g => normalized === g || normalized.startsWith(g + ' '))
  ) {
    return { category: MessageCategory.Greeting, lang, slots };
  }

  const guestEn = ['guest says', 'client says', 'message from guest', 'guest wrote', 'tenant says'];
  const guestRu = ['гость пишет', 'гость сказал', 'сообщение от гостя', 'клиент пишет'];
  if (guestEn.some(t => normalized.includes(t)) || guestRu.some(t => normalized.includes(t))) {
    return { category: MessageCategory.GuestMessage, lang, slots };
  }

  const issueEn = ['problem', 'issue', 'broken', 'not working', 'error', 'urgent', 'complaint', 'noise', 'water', 'electricity', 'lock failed'];
  const issueRu = ['не работает', 'проблема', 'ошибка', 'сломалось', 'срочно', 'жалоба', 'шум', 'вода', 'свет'];
  if (issueEn.some(t => normalized.includes(t)) || issueRu.some(t => normalized.includes(t))) {
    return { category: MessageCategory.Issue, lang, slots };
  }

  const bookingEn = ['check-in', 'check in', 'checkout', 'check-out', 'code', 'access', 'lock', 'door', 'reservation', 'booking', 'arrive', 'arrival'];
  const bookingRu = ['заезд', 'выезд', 'код', 'доступ', 'замок', 'дверь', 'бронь', 'бронирование'];
  if (bookingEn.some(t => normalized.includes(t)) || bookingRu.some(t => normalized.includes(t))) {
    return { category: MessageCategory.Booking, lang, slots };
  }

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
