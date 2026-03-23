/**
 * DEPRECATED — this route is retired.
 *
 * Canonical YooKassa webhook endpoint: POST /api/webhooks/yookassa
 *
 * To migrate: update your YooKassa dashboard webhook URL to
 * https://<your-domain>/api/webhooks/yookassa
 *
 * During the transition period, incoming requests are forwarded to the canonical handler.
 */
import { NextResponse } from 'next/server';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

export async function POST(req: Request): Promise<NextResponse> {
  const bodyText = await req.text();
  try {
    const res = await fetch(`${APP_URL}/api/webhooks/yookassa`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: bodyText,
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    console.error('[YooKassa webhook forward error]', err);
    return NextResponse.json({ error: 'Forward failed' }, { status: 500 });
  }
}
