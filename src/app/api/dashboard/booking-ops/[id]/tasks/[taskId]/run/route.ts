import { NextResponse } from 'next/server';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { getBookingOpsRecord } from '@/lib/booking-ops/repository';
import { runBookingOpsTaskAction } from '@/lib/booking-ops/task-action-runner';
import { BOOKING_OPS_OPEN_TASK_STATUSES } from '@/lib/booking-ops/task-types';
import { getBookingOpsTask } from '@/lib/booking-ops/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string; taskId: string } };

export async function POST(_req: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;

  const recordId = context.params.id;
  const taskId = context.params.taskId;

  const record = await getBookingOpsRecord(recordId);
  if (!record) {
    return NextResponse.json(
      { ok: false, message: 'Операционная запись не найдена.' },
      { status: 404 },
    );
  }

  const taskResult = await getBookingOpsTask(recordId, taskId);
  if (!taskResult.ok) {
    const status = taskResult.error === 'not_found' ? 404 : 500;
    return NextResponse.json(
      { ok: false, message: taskResult.error ?? 'Задача не найдена.' },
      { status },
    );
  }

  const task = taskResult.task;
  if (!BOOKING_OPS_OPEN_TASK_STATUSES.includes(task.status)) {
    return NextResponse.json(
      { ok: false, message: 'Действие доступно только для открытых задач.' },
      { status: 400 },
    );
  }

  const actionResult = await runBookingOpsTaskAction(record, task, {
    createdBy: auth.session.email,
  });

  if (actionResult.blockingReason === 'invalid_task_type') {
    return NextResponse.json(
      { ok: false, message: actionResult.message, actionResult },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: actionResult.ok,
    message: actionResult.message,
    actionResult,
  });
}
