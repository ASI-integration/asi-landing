import { NextResponse } from 'next/server';

import { runTelegramDryRun } from '@/lib/communication/telegram-dry-run';

export const runtime = 'nodejs';

function isAuthorized(req: Request): boolean {
  const expected = process.env.INTERNAL_TEST_SECRET;
  if (!expected) return false;
  const got = req.headers.get('x-internal-test-secret');
  return got === expected;
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

  if (!text || !chatId) {
    return NextResponse.json({ ok: false, error: 'text_and_chatId_required' }, { status: 400 });
  }

  const result = await runTelegramDryRun({ text, chatId, objectName, bookingId });
  return NextResponse.json(result, { status: 200 });
}
