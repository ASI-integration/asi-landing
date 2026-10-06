import { NextResponse } from 'next/server';

import { runTelegramDryRun } from '@/lib/communication/telegram-dry-run';

export const runtime = 'nodejs';

function isAuthorized(req: Request): boolean {
  const expected = process.env.INTERNAL_TEST_SECRET;
  if (!expected) return false;
  const got = req.headers.get('x-internal-test-secret');
  return got === expected;
}

function safeErrorDetail(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? 'unknown_error');
  return raw
    .replace(/postgres(?:ql)?:\/\/\S+/giu, 'postgresql://[REDACTED]')
    .replace(/((?:token|secret|key)=)\S+/giu, '$1[REDACTED]')
    .slice(0, 240);
}

export async function POST(req: Request): Promise<Response> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const text = String(body.text ?? '').trim();
  const chatId = String(body.chatId ?? '').trim();
  const objectName = String(body.objectName ?? '').trim();
  const bookingId = String(body.bookingId ?? '').trim();
  const senderIdentity = String(body.senderIdentity ?? body.sender_identity ?? '').trim();
  const guestTestMode = body.guestTestMode === true || body.guest_test_mode === true;

  if (!text || !chatId) {
    return NextResponse.json({ ok: false, error: 'text_and_chatId_required' }, { status: 400 });
  }

  try {
    const result = await runTelegramDryRun({ text, chatId, objectName, bookingId, senderIdentity, guestTestMode });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const detail = safeErrorDetail(error);
    console.error('[telegram-dry-run] failed', { detail });
    return NextResponse.json(
      { ok: false, error: 'telegram_dry_run_failed', detail },
      { status: 500 },
    );
  }
}
