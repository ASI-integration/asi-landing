import { NextResponse } from 'next/server';

import { processUpdate } from '@/lib/communication/orchestrator';
import type { TelegramUpdate } from '@/lib/communication/types';

export const runtime = 'nodejs';

function getHeader(req: Request, name: string): string | null {
  // Headers are case-insensitive, but Next's Request exposes a normalized map.
  return req.headers.get(name);
}

function preview(text: string, max = 120): string {
  const t = String(text ?? '');
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export async function POST(req: Request): Promise<Response> {
  const secretExpected = process.env.TELEGRAM_WEBHOOK_SECRET;
  const secretGot =
    getHeader(req, 'x-telegram-bot-api-secret-token') ??
    getHeader(req, 'X-Telegram-Bot-Api-Secret-Token');

  // Telegram treats 4xx as final, so keep this strict only when configured.
  if (secretExpected && secretGot !== secretExpected) {
    console.warn('[tg:webhook] 403 secret mismatch', {
      hasSecretHeader: Boolean(secretGot),
    });
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  let update: TelegramUpdate | null = null;
  try {
    update = (await req.json()) as TelegramUpdate;
  } catch (e) {
    console.error('[tg:webhook] invalid json body', e);
    // Always return 200 to prevent Telegram retry storms on bad payloads.
    return NextResponse.json({ ok: true, ignored: 'invalid_json' }, { status: 200 });
  }

  const message = update?.message ?? update?.edited_message;
  const chatId = message?.chat?.id;
  const text = message?.text ?? message?.caption ?? '';
  if (process.env.COMM_PIPELINE_DEBUG === '1' || process.env.TELEGRAM_DEBUG === '1') {
    console.log('[tg:webhook] inbound', {
      update_id: update?.update_id,
      chat_id: chatId,
      text_preview: preview(text),
      has_message: Boolean(message),
    });
  }

  try {
    const result = await processUpdate(update);
    if (process.env.COMM_PIPELINE_DEBUG === '1' || process.env.TELEGRAM_DEBUG === '1') {
      console.log('[tg:webhook] processed', {
        outcome: result.outcome,
        update_id: result.update_id,
        chat_id: (result as any).chat_id,
      });
    }
  } catch (e) {
    console.error('[tg:webhook] processUpdate threw', e);
    // Still 200: Telegram webhooks should not retry due to internal errors.
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

