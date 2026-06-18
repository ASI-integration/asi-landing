import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

type WebhookBotTarget = 'operational' | 'asi_feedback';

function resolveBotTarget(body: Record<string, unknown> | null): WebhookBotTarget {
  const raw = String(body?.bot ?? body?.target ?? 'operational').trim().toLowerCase();
  if (raw === 'asi_feedback' || raw === 'feedback') return 'asi_feedback';
  return 'operational';
}

export async function POST(req: Request) {
  const adminSecret = process.env.ADMIN_SECRET;
  const secret = req.headers.get('x-admin-secret');
  if (adminSecret && secret !== adminSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown> | null = null;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const target = resolveBotTarget(body);
  const token =
    target === 'asi_feedback'
      ? process.env.ASI_FEEDBACK_BOT_TOKEN?.trim()
      : process.env.TELEGRAM_BOT_TOKEN?.trim();
  const tokenLabel = target === 'asi_feedback' ? 'ASI_FEEDBACK_BOT_TOKEN' : 'TELEGRAM_BOT_TOKEN';

  if (!token) {
    return NextResponse.json({ ok: false, error: `Missing ${tokenLabel}` }, { status: 500 });
  }

  const url =
    typeof body?.url === 'string' && body.url.length > 0
      ? body.url
      : 'https://asi-global.ru/api/telegram/webhook';

  const envSecret =
    target === 'asi_feedback'
      ? process.env.ASI_FEEDBACK_WEBHOOK_SECRET?.trim()
      : process.env.TELEGRAM_WEBHOOK_SECRET?.trim();

  const secretToken =
    typeof body?.secret_token === 'string'
      ? body.secret_token
      : envSecret && envSecret.length > 0
        ? envSecret
        : undefined;
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
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    json = { ok: false, raw: text };
  }

  return NextResponse.json(
    {
      ok: res.ok && Boolean(json?.ok),
      http_status: res.status,
      bot: target,
      result: json?.result ?? null,
      description: json?.description ?? null,
      request: {
        url,
        has_secret_token: Boolean(secretToken),
        allowed_updates: allowedUpdates ?? null,
      },
    },
    { status: res.ok ? 200 : 500 },
  );
}
