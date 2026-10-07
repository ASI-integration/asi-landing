import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { executeEligibleAutoSendBatch } from '@/lib/booking-ops/communication-auto-send-executor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  try { body = await req.json(); } catch { /* Empty body remains invalid without accountId. */ }
  const accountId = String(body.accountId ?? body.account_id ?? '').trim();
  if (!UUID_RE.test(accountId)) {
    return NextResponse.json(
      { ok: false, message: 'Для scheduled auto-send нужен корректный accountId.' },
      { status: 400 },
    );
  }
  const source = body.source === 'manual' ? 'operator' : 'scheduled';
  const result = await executeEligibleAutoSendBatch({
    source,
    accountId,
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
