import { NextResponse } from 'next/server';
import { requireAdminSecret } from '@/lib/admin-auth';

export const runtime = 'nodejs';
// Reports webhook/bot state for the bot defined by runtime TELEGRAM_BOT_TOKEN; this endpoint does not define production identity.

async function tgGet(token: string, method: string) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'GET',
    // Don't cache in edge/CDN layers
    cache: 'no-store',
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { ok: false, raw: text };
  }
  return { status: res.status, ok: res.ok, json };
}

export async function GET(req: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const authFailure = requireAdminSecret(req);
  if (authFailure) return authFailure;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return NextResponse.json({ ok: false, error: 'Missing TELEGRAM_BOT_TOKEN' }, { status: 500 });
  }

  try {
    const [me, wh] = await Promise.all([tgGet(token, 'getMe'), tgGet(token, 'getWebhookInfo')]);

    return NextResponse.json({
      ok: true,
      getMe: {
        http_status: me.status,
        ok: me.json?.ok ?? false,
        bot_id: me.json?.result?.id,
        bot_username: me.json?.result?.username,
      },
      webhook: {
        http_status: wh.status,
        ok: wh.json?.ok ?? false,
        url: wh.json?.result?.url ?? null,
        pending_update_count: wh.json?.result?.pending_update_count ?? null,
        last_error_date: wh.json?.result?.last_error_date ?? null,
        last_error_message: wh.json?.result?.last_error_message ?? null,
        ip_address: wh.json?.result?.ip_address ?? null,
        allowed_updates: wh.json?.result?.allowed_updates ?? null,
        max_connections: wh.json?.result?.max_connections ?? null,
      },
    });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: detail }, { status: 500 });
  }
}

