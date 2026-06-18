import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

async function tgGet(token: string, method: string) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'GET',
    cache: 'no-store',
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { ok: false, raw: text };
  }
  return { status: res.status, ok: res.ok, json };
}

function summarizeBot(token: string | undefined, label: string) {
  if (!token) {
    return Promise.resolve({
      label,
      configured: false,
      error: `Missing ${label} token in runtime env`,
    });
  }
  return Promise.all([tgGet(token, 'getMe'), tgGet(token, 'getWebhookInfo')]).then(([me, wh]) => {
    const whResult = (wh.json as { result?: Record<string, unknown> })?.result ?? {};
    return {
      label,
      configured: true,
      getMe: {
        http_status: me.status,
        ok: (me.json as { ok?: boolean })?.ok ?? false,
        bot_id: (me.json as { result?: { id?: number } })?.result?.id ?? null,
        bot_username: (me.json as { result?: { username?: string } })?.result?.username ?? null,
      },
      webhook: {
        http_status: wh.status,
        ok: (wh.json as { ok?: boolean })?.ok ?? false,
        url: whResult.url ?? null,
        pending_update_count: whResult.pending_update_count ?? null,
        last_error_date: whResult.last_error_date ?? null,
        last_error_message: whResult.last_error_message ?? null,
        ip_address: whResult.ip_address ?? null,
        allowed_updates: whResult.allowed_updates ?? null,
        max_connections: whResult.max_connections ?? null,
      },
    };
  });
}

export async function GET(req: Request) {
  const adminSecret = process.env.ADMIN_SECRET;
  const secret = req.headers.get('x-admin-secret');
  if (adminSecret && secret !== adminSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const operationalToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const feedbackToken = process.env.ASI_FEEDBACK_BOT_TOKEN?.trim();
  const expectedUrl = 'https://asi-global.ru/api/telegram/webhook';

  try {
    const [operational, feedback] = await Promise.all([
      summarizeBot(operationalToken, 'TELEGRAM_BOT_TOKEN'),
      summarizeBot(feedbackToken, 'ASI_FEEDBACK_BOT_TOKEN'),
    ]);

    return NextResponse.json({
      ok: true,
      expected_webhook_url: expectedUrl,
      env: {
        has_operational_webhook_secret: Boolean(process.env.TELEGRAM_WEBHOOK_SECRET?.trim()),
        has_feedback_webhook_secret: Boolean(process.env.ASI_FEEDBACK_WEBHOOK_SECRET?.trim()),
        feedback_and_operational_share_bot:
          Boolean(operationalToken && feedbackToken && operationalToken === feedbackToken),
      },
      operational,
      asi_feedback: feedback,
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: detail }, { status: 500 });
  }
}
