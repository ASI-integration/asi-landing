import { NextResponse } from 'next/server';
import { requireCrmOperatorSession, requireOpsAdminSession } from '@/lib/crm/api-auth';
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

  const result = await listBookingOpsCommunicationsForRecord(context.params.id);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, message: result.error ?? 'Не удалось загрузить коммуникации.' },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, communications: result.communications });
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
