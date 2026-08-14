import { NextResponse } from 'next/server';
import { requireAdminSecret } from '@/lib/admin-auth';

export const runtime = 'nodejs';
// Sets webhook for the bot defined by runtime TELEGRAM_BOT_TOKEN; helper scripts calling this endpoint are not the source of truth.

export async function POST(req: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const authFailure = requireAdminSecret(req);
  if (authFailure) return authFailure;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return NextResponse.json({ ok: false, error: 'Missing TELEGRAM_BOT_TOKEN' }, { status: 500 });
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const url = typeof body?.url === 'string' && body.url.length > 0
    ? body.url
    : 'https://asi-global.ru/api/telegram/webhook';

  // If the server expects TELEGRAM_WEBHOOK_SECRET but the webhook is set without
  // secret_token, Telegram will not send the header and our webhook handler will
  // 403 every request (Telegram treats 4xx as final). Default to the env secret.
  const secretToken =
    typeof body?.secret_token === 'string'
      ? body.secret_token
      : (process.env.TELEGRAM_WEBHOOK_SECRET && process.env.TELEGRAM_WEBHOOK_SECRET.trim().length > 0
          ? process.env.TELEGRAM_WEBHOOK_SECRET.trim()
          : undefined);
  const allowedUpdates = Array.isArray(body?.allowed_updates) ? body.allowed_updates : undefined;

  const payload: Record<string, unknown> = { url };
  if (secretToken) payload.secret_token = secretToken;
  if (allowedUpdates) payload.allowed_updates = allowedUpdates;

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    cache: 'no-store',
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { ok: false, raw: text };
  }

  return NextResponse.json(
    {
      ok: res.ok && Boolean(json?.ok),
      http_status: res.status,
      result: json?.result ?? null,
      description: json?.description ?? null,
      request: { url, has_secret_token: Boolean(secretToken), allowed_updates: allowedUpdates ?? null },
    },
    { status: res.ok ? 200 : 500 },
  );
}

