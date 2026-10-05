import { NextResponse } from 'next/server';
import { requireCrmOperatorSession, requireOpsAdminSession } from '@/lib/crm/api-auth';
import { requireBookingOpsApiAccess } from '../access';
import {
  applyBookingLifecycleManualOverride,
  forceBookingLifecycleEscalation,
  getBookingLifecycleOrchestratorSnapshot,
  orchestrateBookingLifecycle,
} from '@/lib/booking-ops/lifecycle-orchestrator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'Не удалось выполнить действие оркестратора.';
}

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;
  const bookingId = new URL(req.url).searchParams.get('bookingId');
  const access = await requireBookingOpsApiAccess(auth.session, bookingId ?? '');
  if (!access.ok) return access.response;
  try {
    const orchestration = await getBookingLifecycleOrchestratorSnapshot(
      access.bookingId,
      true,
      { accountId: access.accountId, propertyId: access.propertyId },
    );
    return NextResponse.json({ ok: true, orchestration });
  } catch (error) {
    return NextResponse.json({ ok: false, message: message(error) }, { status: 400 });
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
  const action = String(body.action ?? 'orchestrate');
  const expectedScope = { accountId: access.accountId, propertyId: access.propertyId };
  try {
    const orchestration = action === 'manual_override'
      ? await applyBookingLifecycleManualOverride({
        bookingId: access.bookingId, action: body.overrideAction ?? body.override_action, reason: body.reason,
        slaItemId: body.slaItemId ?? body.sla_item_id, stage: body.stage, actorId: auth.session.email ?? null,
        expectedScope,
      })
      : action === 'escalate'
        ? await forceBookingLifecycleEscalation(access.bookingId, body.reason, auth.session.email ?? null, expectedScope)
        : await orchestrateBookingLifecycle({
          bookingId: access.bookingId,
          now: body.now as string | undefined,
          runType: 'manual_dashboard',
          actorId: auth.session.email ?? null,
          expectedScope,
        });
    return NextResponse.json({ ok: true, orchestration });
  } catch (error) {
    return NextResponse.json({ ok: false, message: message(error) }, { status: 400 });
  }
}
