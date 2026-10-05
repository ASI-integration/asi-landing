import { NextResponse } from 'next/server';
import { requireBookingOpsApiAccess } from '../../../../access';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import { requireBookingOpsRecordScope } from '@/lib/booking-ops/repository';
import { runBookingOpsTaskAction } from '@/lib/booking-ops/task-action-runner';
import { BOOKING_OPS_OPEN_TASK_STATUSES } from '@/lib/booking-ops/task-types';
import { getBookingOpsTask } from '@/lib/booking-ops/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string; taskId: string } };

export async function POST(_req: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  const access = await requireBookingOpsApiAccess(auth.session, context.params.id);
  if (!access.ok) return access.response;

  const recordId = access.bookingId;
  const taskId = context.params.taskId;
  const expectedScope = { accountId: access.accountId, propertyId: access.propertyId };

  let record;
  try {
    record = await requireBookingOpsRecordScope(recordId, expectedScope);
  } catch {
    return NextResponse.json(
      { ok: false, message: 'booking_scope_mismatch' },
      { status: 403 },
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

  let actionResult;
  try {
    actionResult = await runBookingOpsTaskAction(record, task, {
      createdBy: auth.session.email,
      expectedScope,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'booking_scope_mismatch') {
      return NextResponse.json({ ok: false, message: error.message }, { status: 403 });
    }
    throw error;
  }

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
