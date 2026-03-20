import { NextResponse } from 'next/server';
import { replyToTelegram } from '@/lib/telegram';

interface MessageSlots {
  isUrgent: boolean;
  isAccessRelated: boolean;
  mentionsGuest: boolean;
  mentionsTime: boolean;
  mentionsObject: boolean;
}

function extractSlots(normalized: string): MessageSlots {
  const urgencyTriggers = ['urgent', 'emergency', 'asap', 'срочно', 'быстро'];
  const accessTriggers = ['access', 'lock', 'door', 'code', 'замок', 'дверь', 'код', 'доступ', 'попасть'];
  const guestTriggers = ['guest', 'tenant', 'client', 'гость', 'клиент', 'жилец'];
  const timeTriggers = ['time', 'check-in', 'checkout', 'arrive', 'время', 'заезд', 'выезд', 'прибытие'];
  const objectTriggers = ['object', 'unit', 'apartment', 'room', 'property', 'объект', 'квартира', 'комната', 'апартаменты'];

  return {
    isUrgent: urgencyTriggers.some(t => normalized.includes(t)),
    isAccessRelated: accessTriggers.some(t => normalized.includes(t)),
    mentionsGuest: guestTriggers.some(t => normalized.includes(t)),
    mentionsTime: timeTriggers.some(t => normalized.includes(t)),
    mentionsObject: objectTriggers.some(t => normalized.includes(t)),
  };
}

function getBaseReplies(lang: 'en' | 'ru') {
  if (lang === 'ru') {
    return {
      fallback: "Получено.\nТип сообщения пока не классифицирован.\nСледующий шаг: ручная проверка или общий communication flow.",
      start: "ASI online.\nОтправьте сообщение гостя, проблему или запрос.",
      greeting: "Соединение работает.\nОтправьте сообщение гостя, проблему или запрос.",
      // Upgraded guest message template
      guestMessage: "Получено.\nОбнаружено сообщение от гостя.\nОтправьте точный текст сообщения, если нужен разбор или маршрутизация.\nСледующий шаг: передача в communication flow.",
      issueGeneric: "Получено.\nОбнаружена проблема или инцидент.\nСледующий шаг: передача в incident handling flow.",
      // New specific issue access urgent template
      issueAccessUrgent: "Получено.\nПохоже на проблему с доступом.\nЕсли гость не может попасть внутрь, укажите объект и время заезда.\nСледующий шаг: передача в incident handling flow.",
      bookingGeneric: "Получено.\nОбнаружен запрос по бронированию или доступу.\nСледующий шаг: передача в guest operations flow."
    };
  }
  return {
    fallback: "Received.\nMessage type not yet classified.\nNext step: manual review or general communication flow.",
    start: "ASI online.\nSend a guest message, issue, or request.",
    greeting: "Connection is working.\nSend a guest message, issue, or request.",
    // Upgraded guest message template
    guestMessage: "Received.\nGuest message detected.\nSend the exact guest text if you want routing or draft handling.\nNext step: communication flow.",
    issueGeneric: "Received.\nIssue detected.\nNext step: route to incident handling flow.",
    // New specific issue access urgent template
    issueAccessUrgent: "Received.\nThis looks like an access-related issue.\nIf the guest is locked out, send the property/unit and check-in time.\nNext step: incident handling flow.",
    bookingGeneric: "Received.\nBooking/access-related request detected.\nNext step: route to guest operations flow."
  };
}

function processWebhookMessage(text: string, languageCode?: string): string {
  const normalized = (text || '').trim().toLowerCase();
  
  // Decide language based on Cyrillic presence, falling back to Telegram user language if missing (for e.g., /start)
  const isRuText = /[а-яё]/i.test(normalized);
  const lang = (isRuText || (normalized === '/start' && languageCode === 'ru')) ? 'ru' : 'en';
  
  const templates = getBaseReplies(lang);

  // Guard empty text
  if (!text) return templates.fallback;

  // Extract slots dynamically from the text
  const slots = extractSlots(normalized);

  // 1. start
  if (normalized === '/start') {
    return templates.start;
  }

  // 2. greeting/test
  const greetingsEn = ['hi', 'hello', 'hey', 'test', 'ping'];
  const greetingsRu = ['привет', 'здравствуйте', 'тест', 'пинг'];
  if (
    greetingsEn.some(g => normalized === g || normalized.startsWith(g + ' ')) ||
    greetingsRu.some(g => normalized === g || normalized.startsWith(g + ' '))
  ) {
    return templates.greeting;
  }

  // 3. guest-message
  // Evaluated early so "guest says there is a problem" doesn't falsely trigger only an issue
  const guestEn = ['guest says', 'client says', 'message from guest', 'guest wrote', 'tenant says'];
  const guestRu = ['гость пишет', 'гость сказал', 'сообщение от гостя', 'клиент пишет'];
  if (guestEn.some(t => normalized.includes(t)) || guestRu.some(t => normalized.includes(t))) {
    return templates.guestMessage;
  }

  // 4. issue/problem
  const issueEn = ['problem', 'issue', 'broken', 'not working', 'error', 'urgent', 'complaint', 'noise', 'water', 'electricity', 'lock failed'];
  const issueRu = ['не работает', 'проблема', 'ошибка', 'сломалось', 'срочно', 'жалоба', 'шум', 'вода', 'свет'];
  const isIssue = issueEn.some(t => normalized.includes(t)) || issueRu.some(t => normalized.includes(t));
  
  if (isIssue) {
    if (slots.isAccessRelated && slots.isUrgent) {
      return templates.issueAccessUrgent;
    }
    return templates.issueGeneric;
  }

  // 5. booking/access
  const bookingEn = ['check-in', 'check in', 'checkout', 'check-out', 'code', 'access', 'lock', 'door', 'reservation', 'booking', 'arrive', 'arrival'];
  const bookingRu = ['заезд', 'выезд', 'код', 'доступ', 'замок', 'дверь', 'бронь', 'бронирование'];
  const isBooking = bookingEn.some(t => normalized.includes(t)) || bookingRu.some(t => normalized.includes(t));
  
  if (isBooking) {
    return templates.bookingGeneric;
  }

  // 6. fallback
  return templates.fallback;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Basic guards
    const message = body?.message || body?.edited_message;
    const chatId = message?.chat?.id;
    const text = message?.text;
    const languageCode = message?.from?.language_code; 

    if (chatId) {
      const replyText = processWebhookMessage(text, languageCode);
      await replyToTelegram(chatId, replyText);
    }

    // Return 200 quickly
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[Telegram Webhook] Error:', error);
    // Return 200 even on error so Telegram does not retry continuously
    return NextResponse.json({ ok: true });
  }
}
