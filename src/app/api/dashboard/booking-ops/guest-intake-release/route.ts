import { NextResponse } from 'next/server';
import { requireCrmOperatorSession, requireOpsAdminSession } from '@/lib/crm/api-auth';
import { requireBookingOpsApiAccess } from '../access';
import {
  ensureGuestIntakeSession,
  escalateGuestIntake,
  getGuestIntakeReleaseSnapshot,
  prepareGuestIntakeDraft,
  submitGuestIntakeSimulated,
} from '@/lib/booking-ops/guest-intake-checkin-release';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;
  const bookingId = new URL(req.url).searchParams.get('bookingId');
  const access = await requireBookingOpsApiAccess(auth.session, String(bookingId ?? ''));
  if (!access.ok) return access.response;
  const expectedScope = { accountId: access.accountId, propertyId: access.propertyId };
  try {
    return NextResponse.json({
      ok: true,
      snapshot: await getGuestIntakeReleaseSnapshot(access.bookingId, expectedScope),
    });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Не удалось загрузить данные гостя.' }, { status: 400 });
  }
}
export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ ok: false, message: 'Некорректный JSON.' }, { status: 400 }); }
  const bookingId = body.bookingId ?? body.booking_id;
  const access = await requireBookingOpsApiAccess(auth.session, String(bookingId ?? ''));
  if (!access.ok) return access.response;
  const action = String(body.action ?? '');
  const expectedScope = { accountId: access.accountId, propertyId: access.propertyId };
  try {
    if (action === 'ensure_session') await ensureGuestIntakeSession(access.bookingId, expectedScope);
    else if (action === 'prepare_initial_draft') await prepareGuestIntakeDraft(access.bookingId, 'initial', expectedScope);
    else if (action === 'prepare_reminder_draft') await prepareGuestIntakeDraft(access.bookingId, 'reminder', expectedScope);
    else if (action === 'submit_simulated') {
      await submitGuestIntakeSimulated(
        access.bookingId,
        body.fields,
        auth.session.email ?? undefined,
        expectedScope,
      );
    }
    else if (action === 'escalate') {
      await escalateGuestIntake(
        access.bookingId,
        body.reason,
        auth.session.email ?? undefined,
        expectedScope,
      );
    }
    else return NextResponse.json({ ok: false, message: 'Недопустимое действие.' }, { status: 400 });
    return NextResponse.json({
      ok: true,
      snapshot: await getGuestIntakeReleaseSnapshot(access.bookingId, expectedScope),
    });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'Действие не выполнено.' }, { status: 400 });
  }
}
