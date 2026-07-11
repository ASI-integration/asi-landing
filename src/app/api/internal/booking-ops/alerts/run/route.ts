import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { orchestrateAllRelevantOpsAlerts } from '@/lib/booking-ops/ops-alert-orchestrator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorized(request: Request): boolean {
  const expected = process.env.BOOKING_OPS_ALERT_RUNNER_SECRET?.trim() || process.env.CRON_SECRET?.trim();
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  return Boolean(expected && supplied && expected.length === supplied.length
    && timingSafeEqual(Buffer.from(expected!), Buffer.from(supplied)));
}

export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ ok: false, message: 'Нет доступа.' }, { status: 401 });
  const result = await orchestrateAllRelevantOpsAlerts(new Date().toISOString(), 'scheduled');
  return NextResponse.json({ ok: result.errors.length === 0, result }, { status: result.errors.length ? 500 : 200 });
}
