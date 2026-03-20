import { NextResponse } from 'next/server';
import { replyToTelegram } from '@/lib/telegram';

const REPLIES = {
  en: {
    start: "ASI online.\nSend a guest message, issue, or request.",
    greeting: "Connection is working.\nSend a guest message, issue, or request.",
    guestMessage: "Received.\nGuest message detected.\nNext step: route to communication flow.",
    issue: "Received.\nIssue detected.\nNext step: route to incident handling flow.",
    booking: "Received.\nBooking/access-related request detected.\nNext step: route to guest operations flow.",
    fallback: "Received.\nMessage type not yet classified.\nNext step: manual review or general communication flow."
  },
  ru: {
    start: "ASI online.\nОтправьте сообщение гостя, проблему или запрос.",
    greeting: "Соединение работает.\nОтправьте сообщение гостя, проблему или запрос.",
    guestMessage: "Получено.\nОбнаружено сообщение от гостя.\nСледующий шаг: передача в communication flow.",
    issue: "Получено.\nОбнаружена проблема или инцидент.\nСледующий шаг: передача в incident handling flow.",
    booking: "Получено.\nОбнаружен запрос по бронированию или доступу.\nСледующий шаг: передача в guest operations flow.",
    fallback: "Получено.\nТип сообщения пока не классифицирован.\nСледующий шаг: ручная проверка или общий communication flow."
  }
};

function classifyMessage(text: string, languageCode?: string): string {
  // Guard empty text
  if (!text) return REPLIES.en.fallback;

  const normalized = text.trim().toLowerCase();

  // Detect Russian text. If text contains Cyrillic characters, or it's a `/start` from a user with RU locale.
  const isRuText = /[а-яё]/i.test(normalized);
  const lang = (isRuText || (normalized === '/start' && languageCode === 'ru')) ? 'ru' : 'en';

  // 1. start
  if (normalized === '/start') {
    return REPLIES[lang].start;
  }

  // 2. greeting/test
  const greetingsEn = ['hi', 'hello', 'hey', 'test', 'ping'];
  const greetingsRu = ['привет', 'здравствуйте', 'тест', 'пинг'];
  if (
    greetingsEn.some(g => normalized === g || normalized.startsWith(g + ' ')) ||
    greetingsRu.some(g => normalized === g || normalized.startsWith(g + ' '))
  ) {
    return REPLIES[lang].greeting;
  }

  // 3. guest-message
  // Evaluated early so "guest says there is a problem" doesn't falsely trigger only an issue
  const guestEn = ['guest says', 'client says', 'message from guest', 'guest wrote', 'tenant says'];
  const guestRu = ['гость пишет', 'гость сказал', 'сообщение от гостя', 'клиент пишет'];
  if (guestEn.some(t => normalized.includes(t)) || guestRu.some(t => normalized.includes(t))) {
    return REPLIES[lang].guestMessage;
  }

  // 4. issue/problem
  const issueEn = ['problem', 'issue', 'broken', 'not working', 'error', 'urgent', 'complaint', 'noise', 'water', 'electricity', 'lock failed'];
  const issueRu = ['не работает', 'проблема', 'ошибка', 'сломалось', 'срочно', 'жалоба', 'шум', 'вода', 'свет'];
  if (issueEn.some(t => normalized.includes(t)) || issueRu.some(t => normalized.includes(t))) {
    return REPLIES[lang].issue;
  }

  // 5. booking/access
  const bookingEn = ['check-in', 'check in', 'checkout', 'check-out', 'code', 'access', 'lock', 'door', 'reservation', 'booking', 'arrive', 'arrival'];
  const bookingRu = ['заезд', 'выезд', 'код', 'доступ', 'замок', 'дверь', 'бронь', 'бронирование'];
  if (bookingEn.some(t => normalized.includes(t)) || bookingRu.some(t => normalized.includes(t))) {
    return REPLIES[lang].booking;
  }

  // 6. fallback
  return REPLIES[lang].fallback;
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
      const replyText = classifyMessage(text, languageCode);
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
