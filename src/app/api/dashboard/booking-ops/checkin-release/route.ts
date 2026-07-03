import { NextResponse } from 'next/server';
import { requireCrmOperatorSession, requireOpsAdminSession } from '@/lib/crm/api-auth';
import {
  getGuestIntakeReleaseSnapshot,
  prepareCheckinReleaseDraft,
  simulateCheckinRelease,
} from '@/lib/booking-ops/guest-intake-checkin-release';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;
  const bookingId = new URL(req.url).searchParams.get('bookingId');
  try {
    return NextResponse.json({ ok: true, snapshot: await getGuestIntakeReleaseSnapshot(bookingId) });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Не удалось загрузить выдачу инструкций.' }, { status: 400 });
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ ok: false, message: 'Некорректный JSON.' }, { status: 400 }); }
  const bookingId = body.bookingId ?? body.booking_id;
  try {
    if (body.action === 'prepare_draft') await prepareCheckinReleaseDraft(bookingId, auth.session.email ?? undefined);
    else if (body.action === 'simulate_release') await simulateCheckinRelease(bookingId, body.confirmSimulatedRelease, auth.session.email ?? undefined);
    else return NextResponse.json({ ok: false, message: 'Недопустимое действие.' }, { status: 400 });
    return NextResponse.json({ ok: true, snapshot: await getGuestIntakeReleaseSnapshot(bookingId) });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Действие не выполнено.' }, { status: 400 });
  }
}
