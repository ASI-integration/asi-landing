import { NextResponse } from 'next/server';

import { processSupportBotUpdate } from '@/lib/communication/telegram-support-bot';

export const runtime = 'nodejs';

function getHeader(req: Request, name: string): string | null {
  return req.headers.get(name);
}

export async function POST(req: Request): Promise<Response> {
  const secretExpected = process.env.TELEGRAM_SUPPORT_WEBHOOK_SECRET;
  const secretGot =
    getHeader(req, 'x-telegram-bot-api-secret-token') ??
    getHeader(req, 'X-Telegram-Bot-Api-Secret-Token');

  if (secretExpected && secretGot !== secretExpected) {
    console.warn('[tg:support-webhook] 403 secret mismatch', {
      hasSecretHeader: Boolean(secretGot),
    });
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  let update: Parameters<typeof processSupportBotUpdate>[0] = null;
  try {
    update = (await req.json()) as NonNullable<Parameters<typeof processSupportBotUpdate>[0]>;
  } catch (e) {
    console.error('[tg:support-webhook] invalid json body', e);
    return NextResponse.json({ ok: true, ignored: 'invalid_json' }, { status: 200 });
  }

  const message = update?.edited_message ?? update?.message;
  const chatId = message?.chat?.id;
  const text = message?.text ?? message?.caption ?? '';

  console.info('[tg:support-webhook] recv', {
    update_id: update?.update_id,
    chat_id: chatId,
    has_text: Boolean(text),
  });

  try {
    const result = await processSupportBotUpdate(update);
    return NextResponse.json(
      {
        ok: true,
        outcome: result.outcome,
        intent: result.intent,
      },
      { status: 200 },
    );
  } catch (e) {
    console.error('[tg:support-webhook] processSupportBotUpdate threw', e);
    return NextResponse.json({ ok: true, error: 'internal' }, { status: 200 });
  }
}
