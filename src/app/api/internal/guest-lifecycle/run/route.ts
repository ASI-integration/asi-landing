import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { runDueGuestLifecycleEvents } from '@/lib/communication/guest-lifecycle-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorized(req: Request): boolean {
  const expected = process.env.BOOKING_OPS_AUTO_SEND_RUNNER_SECRET?.trim() || process.env.CRON_SECRET?.trim();
  const supplied = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  if (!expected || !supplied || expected.length !== supplied.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}
export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false, message: 'Нет доступа.' }, { status: 401 });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* Empty runner body is valid. */ }
  const result = await runDueGuestLifecycleEvents({
    dryRun: body.dryRun === true || body.dry_run === true,
    limit: Math.min(Math.max(Number(body.limit ?? 20) || 20, 1), 100),
  });
  if (!result.ok) return NextResponse.json({ ok: false, processed: 0, error: result.error }, { status: 500 });
  return NextResponse.json({
    ok: true,
    processed: result.results.length,
    sent: result.results.filter((item) => item.record.status === 'sent').length,
    dryRun: result.results.filter((item) => item.record.status === 'dry_run').length,
    operatorRequired: result.results.filter((item) => item.record.status === 'operator_required').length,
    failed: result.results.filter((item) => item.record.status === 'failed' || item.record.status === 'blocked').length,
  });
}
