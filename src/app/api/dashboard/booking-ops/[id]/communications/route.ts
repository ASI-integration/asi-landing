import { NextResponse } from 'next/server';
import { requireCrmOperatorSession, requireOpsAdminSession } from '@/lib/crm/api-auth';
import { resolveReservationAccess } from '@/lib/reservations/access';
import { sameIdentity } from '@/lib/platform/decision';
import { adaptCommunicationDecision } from '@/lib/platform/communication-decision';
import { resolveResidentialBookingIdentity } from '@/lib/platform/residential-booking-scope';
import { prepareBookingCommunication } from '@/lib/communication/booking-knowledge-boundary';
import { getBookingOpsRecord } from '@/lib/booking-ops/repository';
import {
  listBookingOpsCommunicationsForRecord,
  syncBookingOpsCommunications,
} from '@/lib/booking-ops/communication-orchestrator';
import { listBookingOpsTasksForRecord } from '@/lib/booking-ops/tasks';
import { syncGuestIntakeAutopilot } from '@/lib/booking-ops/guest-intake-autopilot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

export async function GET(_req: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  try {
    const access = await resolveReservationAccess(auth.session);
    const identity = await resolveResidentialBookingIdentity(context.params.id, access.accountId);
    const result = await listBookingOpsCommunicationsForRecord(context.params.id);
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
          recordId: context.params.id,
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

    const currentIdentity = await resolveResidentialBookingIdentity(context.params.id, access.accountId);
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

  const [record, tasksResult] = await Promise.all([
    getBookingOpsRecord(context.params.id),
    listBookingOpsTasksForRecord(context.params.id),
  ]);
  if (!record) {
    return NextResponse.json({ ok: false, message: 'Запись не найдена.' }, { status: 404 });
  }
  if (!tasksResult.ok) {
    return NextResponse.json(
      { ok: false, message: tasksResult.error ?? 'Не удалось загрузить задачи.' },
      { status: 500 },
    );
  }

  const guestIntake = await syncGuestIntakeAutopilot(record);
  const result = await syncBookingOpsCommunications({
    record: { ...record, guestIntake: guestIntake.session ?? record.guestIntake ?? null },
    tasks: tasksResult.tasks,
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
}
