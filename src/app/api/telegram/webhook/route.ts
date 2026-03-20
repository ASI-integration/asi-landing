import { NextResponse } from 'next/server';
import { replyToTelegram } from '@/lib/telegram';

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Basic guards to ensure we have a chat ID
    const message = body?.message || body?.edited_message;
    const chatId = message?.chat?.id;

    if (chatId) {
      await replyToTelegram(chatId, 'Telegram connected');
    }

    // Return 200 quickly
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[Telegram Webhook] Error:', error);
    // Return 200 even on error so Telegram does not retry continuously
    return NextResponse.json({ ok: true });
  }
}
