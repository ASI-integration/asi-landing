import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { resolveReservationAccess } from '@/lib/reservations/access';
import { runGoldenPathAcceptance } from '@/lib/booking-ops/golden-path-acceptance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  try {
    const body = await req.json() as Record<string, unknown>;
    const identifier = String(body.bookingOpsRecordId ?? body.asiReference ?? '').trim();
    if (!identifier) return NextResponse.json({ ok: false, message: 'bookingOpsRecordId_or_asiReference_required' }, { status: 400 });
    const access = await resolveReservationAccess(auth.session);
    const report = await runGoldenPathAcceptance({ identifier, accountId: access.accountId, actorId: access.actorId, dryRun: body.dryRun !== false, confirm: body.confirm === true, featureEnabled: process.env.OPS_GOLDEN_PATH_ACCEPTANCE_ENABLED === 'true' });
    return NextResponse.json({ ok: report.overall !== 'FAIL', report }, { status: report.overall === 'FAIL' ? 422 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'acceptance_failed';
    const status = message.includes('account') ? 403 : message.includes('not_found') ? 404 : 400;
    return NextResponse.json({ ok: false, message }, { status });
  }
}
