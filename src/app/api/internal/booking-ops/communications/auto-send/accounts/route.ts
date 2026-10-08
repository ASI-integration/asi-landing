import { isAuthorizedBookingOpsRunner } from '@/lib/booking-ops/communication-auto-send-runner-auth';
import { NextResponse } from 'next/server';
import { listScheduledAutoSendAccountIds } from '@/lib/booking-ops/communication-auto-send-scopes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!isAuthorizedBookingOpsRunner(req)) {
    return NextResponse.json({ ok: false, message: 'Нет доступа.' }, { status: 401 });
  }

  const accountIds = await listScheduledAutoSendAccountIds();
  return NextResponse.json({ ok: true, accountIds, count: accountIds.length });
}
