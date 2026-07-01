import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { executeEligibleAutoSendBatch } from '@/lib/booking-ops/communication-auto-send-executor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorized(req: Request): boolean {
  const expected = process.env.BOOKING_OPS_AUTO_SEND_RUNNER_SECRET?.trim() || process.env.CRON_SECRET?.trim();
  const supplied = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  if (!expected || !supplied || expected.length !== supplied.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

export async function POST(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, message: 'Нет доступа.' }, { status: 401 });
  }
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* Empty cron body is valid. */ }
  const result = await executeEligibleAutoSendBatch({
    source: 'scheduled',
    dryRun: body.dryRun === true || body.dry_run === true,
    maxBatchSize: Math.min(Math.max(Number(body.maxBatchSize ?? body.max_batch_size ?? 10) || 10, 1), 20),
  });
  return NextResponse.json({
    ok: result.ok,
    processed: result.processed,
    sent: result.sent ?? 0,
    dryRun: result.dryRun ?? 0,
    failed: result.failed ?? 0,
    blocked: result.blocked ?? 0,
    summary: result.safeSummary ?? 'Безопасная обработка завершена.',
  }, { status: result.ok ? 200 : 500 });
}
