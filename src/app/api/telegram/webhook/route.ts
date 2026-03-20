import { NextResponse } from 'next/server';
import { replyToTelegram } from '@/lib/telegram';
import { callLLM } from '@/lib/openai';

// ─── Types ────────────────────────────────────────────────────────────────────

type Lang = 'en' | 'ru';

type Category =
  | 'start'
  | 'greeting'
  | 'guest-message'
  | 'issue'
  | 'booking'
  | 'fallback';

interface MessageSlots {
  isUrgent: boolean;
  isAccessRelated: boolean;
  mentionsGuest: boolean;
  mentionsTime: boolean;
  mentionsObject: boolean;
}

interface ClassifyResult {
  category: Category;
  lang: Lang;
  slots: MessageSlots;
}

// ─── Slot Extraction ──────────────────────────────────────────────────────────

function extractSlots(normalized: string): MessageSlots {
  return {
    isUrgent: ['urgent', 'emergency', 'asap', 'срочно', 'быстро'].some(t => normalized.includes(t)),
    isAccessRelated: ['access', 'lock', 'door', 'code', 'замок', 'дверь', 'код', 'доступ', 'попасть'].some(t => normalized.includes(t)),
    mentionsGuest: ['guest', 'tenant', 'client', 'гость', 'клиент', 'жилец'].some(t => normalized.includes(t)),
    mentionsTime: ['time', 'check-in', 'checkout', 'arrive', 'время', 'заезд', 'выезд', 'прибытие'].some(t => normalized.includes(t)),
    mentionsObject: ['object', 'unit', 'apartment', 'room', 'property', 'объект', 'квартира', 'комната', 'апартаменты'].some(t => normalized.includes(t)),
  };
}

// ─── Deterministic Classifier ─────────────────────────────────────────────────

function classify(text: string, languageCode?: string): ClassifyResult {
  const normalized = (text || '').trim().toLowerCase();
  const isRuText = /[а-яё]/i.test(normalized);
  const lang: Lang = (isRuText || (normalized === '/start' && languageCode === 'ru')) ? 'ru' : 'en';
  const slots = extractSlots(normalized);

  if (!text) return { category: 'fallback', lang, slots };
  if (normalized === '/start') return { category: 'start', lang, slots };

  const greetingsEn = ['hi', 'hello', 'hey', 'test', 'ping'];
  const greetingsRu = ['привет', 'здравствуйте', 'тест', 'пинг'];
  if (
    greetingsEn.some(g => normalized === g || normalized.startsWith(g + ' ')) ||
    greetingsRu.some(g => normalized === g || normalized.startsWith(g + ' '))
  ) {
    return { category: 'greeting', lang, slots };
  }

  const guestEn = ['guest says', 'client says', 'message from guest', 'guest wrote', 'tenant says'];
  const guestRu = ['гость пишет', 'гость сказал', 'сообщение от гостя', 'клиент пишет'];
  if (guestEn.some(t => normalized.includes(t)) || guestRu.some(t => normalized.includes(t))) {
    return { category: 'guest-message', lang, slots };
  }

  const issueEn = ['problem', 'issue', 'broken', 'not working', 'error', 'urgent', 'complaint', 'noise', 'water', 'electricity', 'lock failed'];
  const issueRu = ['не работает', 'проблема', 'ошибка', 'сломалось', 'срочно', 'жалоба', 'шум', 'вода', 'свет'];
  if (issueEn.some(t => normalized.includes(t)) || issueRu.some(t => normalized.includes(t))) {
    return { category: 'issue', lang, slots };
  }

  const bookingEn = ['check-in', 'check in', 'checkout', 'check-out', 'code', 'access', 'lock', 'door', 'reservation', 'booking', 'arrive', 'arrival'];
  const bookingRu = ['заезд', 'выезд', 'код', 'доступ', 'замок', 'дверь', 'бронь', 'бронирование'];
  if (bookingEn.some(t => normalized.includes(t)) || bookingRu.some(t => normalized.includes(t))) {
    return { category: 'booking', lang, slots };
  }

  return { category: 'fallback', lang, slots };
}

// ─── Deterministic Fallback Replies ──────────────────────────────────────────

function deterministicReply(result: ClassifyResult): string {
  const { category, lang, slots } = result;

  if (lang === 'ru') {
    switch (category) {
      case 'start':    return 'ASI online.\nОтправьте сообщение гостя, проблему или запрос.';
      case 'greeting': return 'Соединение работает.\nОтправьте сообщение гостя, проблему или запрос.';
      case 'guest-message': return 'Понял. Отправьте точный текст сообщения от гостя — разберём и направим дальше.';
      case 'issue':
        return slots.isAccessRelated && slots.isUrgent
          ? 'Понял, похоже на проблему с доступом. Укажите объект и время заезда гостя — передадим в нужный поток.'
          : 'Понял. Опишите проблему подробнее — передадим в incident handling flow.';
      case 'booking': return 'Понял. Укажите объект, даты и гостя — передадим в guest operations flow.';
      default:         return 'Получено. Тип запроса пока не определён — передаём на ручную проверку.';
    }
  }

  switch (category) {
    case 'start':    return 'ASI online.\nSend a guest message, issue, or request.';
    case 'greeting': return 'Connection is working.\nSend a guest message, issue, or request.';
    case 'guest-message': return 'Got it. Share the exact guest message and I\'ll help route or draft a reply.';
    case 'issue':
      return slots.isAccessRelated && slots.isUrgent
        ? 'Understood — looks like an urgent access issue. Send the property/unit and check-in time so this can be escalated.'
        : 'Got it. Describe the issue in more detail and it will be routed to incident handling.';
    case 'booking': return 'Got it. Share the property, dates, and guest name and this will go to guest operations.';
    default:         return 'Received. Message type is unclear — passing to manual review.';
  }
}

// ─── LLM System Prompt ────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an operations assistant for a short-term rental (STR) management company.
You receive operational messages forwarded by staff via Telegram — these may include guest complaints, access issues, booking questions, or forwarded guest messages.

Rules:
- Reply in the same language as the user message (English or Russian)
- Be concise: 1–3 short sentences max
- Sound human and operational, not robotic
- Do not claim actions were taken if they weren't
- Do not hallucinate missing details
- If key information is missing (property, time, guest name), ask for the single most important missing item
- Do not use bullet lists or headers — plain conversational text only`;

// ─── LLM Prompt Builder ───────────────────────────────────────────────────────

function buildUserPrompt(text: string, result: ClassifyResult): string {
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

// ─── Categories that use LLM ─────────────────────────────────────────────────

const LLM_CATEGORIES: Category[] = ['guest-message', 'issue', 'booking', 'fallback'];

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const message = body?.message || body?.edited_message;
    const chatId = message?.chat?.id;
    const text = message?.text;
    const languageCode = message?.from?.language_code;

    if (chatId) {
      const classifyResult = classify(text, languageCode);
      let replyText: string;

      if (text && LLM_CATEGORIES.includes(classifyResult.category)) {
        const llmReply = await callLLM({
          systemPrompt: SYSTEM_PROMPT,
          userMessage: buildUserPrompt(text, classifyResult),
        });
        // Use LLM reply if successful, otherwise fall back to deterministic
        replyText = llmReply ?? deterministicReply(classifyResult);
      } else {
        replyText = deterministicReply(classifyResult);
      }

      await replyToTelegram(chatId, replyText);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[Telegram Webhook] Error:', error);
    // Return 200 even on error so Telegram does not retry continuously
    return NextResponse.json({ ok: true });
  }
}
