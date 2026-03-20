import { NextResponse } from 'next/server';
import { replyToTelegram } from '@/lib/telegram';

const FALLBACK_REPLY = "Received.\nMessage type not yet classified.\nNext step: manual review or general communication flow.";

function classifyMessage(text: string): string {
  // Guard empty text (could be an image or unsupported type)
  if (!text) return FALLBACK_REPLY;

  const normalized = text.trim().toLowerCase();

  // 1. start
  if (normalized === '/start') {
    return "ASI online.\nSend a guest message, issue, or request.";
  }

  // 2. greeting/test
  const greetings = ['hi', 'hello', 'hey', 'test', 'ping'];
  if (greetings.some(g => normalized === g || normalized.startsWith(g + ' '))) {
    return "Connection is working.\nSend a guest message, issue, or request.";
  }

  // 3. guest-message
  // Evaluated early so "guest says there is a problem" doesn't falsely trigger only an issue
  const guestTriggers = ['guest says', 'client says', 'message from guest', 'guest wrote', 'tenant says'];
  if (guestTriggers.some(t => normalized.includes(t))) {
    return "Received.\nGuest message detected.\nNext step: route to communication flow.";
  }

  // 4. issue/problem
  const issueTriggers = ['problem', 'issue', 'broken', 'not working', 'error', 'urgent', 'complaint', 'noise', 'water', 'electricity', 'lock failed'];
  if (issueTriggers.some(t => normalized.includes(t))) {
    return "Received.\nIssue detected.\nNext step: route to incident handling flow.";
  }

  // 5. booking/access
  const bookingTriggers = ['check-in', 'check in', 'checkout', 'check-out', 'code', 'access', 'lock', 'door', 'reservation', 'booking', 'arrive', 'arrival'];
  if (bookingTriggers.some(t => normalized.includes(t))) {
    return "Received.\nBooking/access-related request detected.\nNext step: route to guest operations flow.";
  }

  // 6. fallback
  return FALLBACK_REPLY;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Basic guards to ensure we have a chat ID and possibly text
    const message = body?.message || body?.edited_message;
    const chatId = message?.chat?.id;
    const text = message?.text;

    if (chatId) {
      const replyText = classifyMessage(text);
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
