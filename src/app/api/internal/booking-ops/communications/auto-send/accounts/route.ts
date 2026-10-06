import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { listScheduledAutoSendAccountIds } from '@/lib/booking-ops/communication-auto-send-scopes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorized(req: Request): boolean {
  const expected = process.env.BOOKING_OPS_AUTO_SEND_RUNNER_SECRET?.trim() || process.env.CRON_SECRET?.trim();
  const supplied = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  if (!expected || !supplied || expected.length !== supplied.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, message: 'Нет доступа.' }, { status: 401 });
  }

  const accountIds = await listScheduledAutoSendAccountIds();
  return NextResponse.json({ ok: true, accountIds, count: accountIds.length });
}
