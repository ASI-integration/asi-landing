import { NextResponse } from 'next/server';
import { requireCrmOperatorSession, requireOpsAdminSession } from '@/lib/crm/api-auth';
import { sameIdentity } from '@/lib/platform/decision';
import { adaptCommunicationDecision } from '@/lib/platform/communication-decision';
import { resolveResidentialBookingIdentity } from '@/lib/platform/residential-booking-scope';
import { prepareBookingCommunication } from '@/lib/communication/booking-knowledge-boundary';
import { requireBookingOpsRecordScope } from '@/lib/booking-ops/repository';
import {
  listBookingOpsCommunicationsForRecord,
  syncBookingOpsCommunications,
} from '@/lib/booking-ops/communication-orchestrator';
import { listBookingOpsTasksForRecord } from '@/lib/booking-ops/tasks';
import { syncGuestIntakeAutopilot } from '@/lib/booking-ops/guest-intake-autopilot';
import { requireBookingOpsApiAccess } from '../../access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

export async function GET(_req: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  const access = await requireBookingOpsApiAccess(auth.session, context.params.id);
  if (!access.ok) return access.response;

  try {
    const identity = await resolveResidentialBookingIdentity(access.bookingId, access.accountId);
    const result = await listBookingOpsCommunicationsForRecord(access.bookingId);
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, message: result.error ?? 'Не удалось загрузить коммуникации.' },
        { status: 500 },
      );
    }

    const platformDecisions = await Promise.all(result.communications
      .filter((intent) => intent.actorType === 'guest')
      .map(async (intent) => {
        const prepared = await prepareBookingCommunication({
          recordId: access.bookingId,
          accountId: identity.accountId,
          propertyId: identity.propertyId,
          purpose: intent.purpose,
        });
        const decision = adaptCommunicationDecision({
          identity,
          result: prepared.result.scope ? prepared.result : null,
          now: Date.now(),
        });
        return { communicationId: intent.id, decision };
      }));

    const currentIdentity = await resolveResidentialBookingIdentity(access.bookingId, access.accountId);
    if (!sameIdentity(identity, currentIdentity)) {
      return NextResponse.json(
        { ok: false, message: 'Состояние бронирования изменилось. Повторите запрос.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ ok: true, communications: result.communications, platformDecisions });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'booking_not_found') {
      return NextResponse.json({ ok: false, message: 'Бронирование не найдено.' }, { status: 404 });
    }
    if (code === 'booking_scope_mismatch' || code === 'reservation_account_not_found') {
      return NextResponse.json({ ok: false, message: 'Нет доступа к бронированию.' }, { status: 403 });
    }
    if (code === 'booking_scope_unavailable') {
      return NextResponse.json({ ok: false, message: 'Не удалось подтвердить область бронирования.' }, { status: 409 });
    }
    return NextResponse.json({ ok: false, message: 'Не удалось загрузить коммуникации.' }, { status: 500 });
  }
}

export async function POST(_req: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  const access = await requireBookingOpsApiAccess(auth.session, context.params.id);
  if (!access.ok) return access.response;
  const expectedScope = { accountId: access.accountId, propertyId: access.propertyId };

  try {
    const [record, tasksResult] = await Promise.all([
      requireBookingOpsRecordScope(access.bookingId, expectedScope),
      listBookingOpsTasksForRecord(access.bookingId, { expectedScope }),
    ]);
    if (!tasksResult.ok) {
      return NextResponse.json(
        { ok: false, message: tasksResult.error ?? 'Не удалось загрузить задачи.' },
        { status: 500 },
      );
    }

    const guestIntake = await syncGuestIntakeAutopilot(record, expectedScope);
    const result = await syncBookingOpsCommunications({
      record: { ...record, guestIntake: guestIntake.session ?? record.guestIntake ?? null },
      tasks: tasksResult.tasks,
      expectedScope,
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, message: result.error ?? 'Не удалось пересчитать коммуникации.' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      communications: result.communications,
      nextAction: result.plan.nextAction,
      message: 'Коммуникации пересчитаны. Внешние сообщения не отправлялись.',
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'booking_scope_mismatch') {
      return NextResponse.json({ ok: false, message: 'Нет доступа к бронированию.' }, { status: 403 });
    }
    return NextResponse.json({ ok: false, message: 'Не удалось пересчитать коммуникации.' }, { status: 500 });
  }
}
