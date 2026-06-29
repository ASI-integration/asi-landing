import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import {
  getBookingOpsRecord,
  syncBookingOpsTasksForRecordId,
} from '@/lib/booking-ops/repository';
import { planBookingOpsPreparation } from '@/lib/booking-ops/automation-engine';
import { syncBookingOpsCommunications } from '@/lib/booking-ops/communication-orchestrator';
import { syncGuestIntakeAutopilot } from '@/lib/booking-ops/guest-intake-autopilot';
import { listBookingOpsTasksForRecord } from '@/lib/booking-ops/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

export async function POST(_req: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;

  const sync = await syncBookingOpsTasksForRecordId(context.params.id);
  if (!sync.ok) {
    const status = sync.error === 'not_found' ? 404 : 500;
    return NextResponse.json(
      { ok: false, message: sync.error ?? 'Не удалось пересчитать подготовку.' },
      { status },
    );
  }

  const [record, tasksResult] = await Promise.all([
    getBookingOpsRecord(context.params.id),
    listBookingOpsTasksForRecord(context.params.id),
  ]);
  if (!record || !tasksResult.ok) {
    return NextResponse.json(
      { ok: false, message: 'Подготовка пересчитана, но не удалось обновить карточку.' },
      { status: 500 },
    );
  }

  const guestIntake = await syncGuestIntakeAutopilot(record);
  const recordWithIntake = { ...record, guestIntake: guestIntake.session ?? record.guestIntake ?? null };

  const communications = await syncBookingOpsCommunications({
    record: recordWithIntake,
    tasks: tasksResult.tasks,
  });

  return NextResponse.json({
    ok: true,
    record: recordWithIntake,
    tasks: tasksResult.tasks,
    guestIntake: recordWithIntake.guestIntake,
    communications: communications.communications,
    communicationNextAction: communications.plan.nextAction,
    preparation: planBookingOpsPreparation(record, tasksResult.tasks),
    message: 'Подготовка и коммуникации пересчитаны. Внешние сообщения не отправлялись.',
  });
}
