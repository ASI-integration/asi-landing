import { NextResponse } from 'next/server';
import { requireBookingOpsApiAccess } from '../../../access';
import { requireOpsAdminSession } from '@/lib/crm/api-auth';
import {
  listBookingOpsTasksForRecord,
  parseUpdateBookingOpsTaskInput,
} from '@/lib/booking-ops/tasks';
import { updateBookingOpsTaskWithCompletionEffects } from '@/lib/booking-ops/task-completion-effects';
import { requireBookingOpsRecordScope } from '@/lib/booking-ops/repository';
import { syncBookingOpsCommunications } from '@/lib/booking-ops/communication-orchestrator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string; taskId: string } };

export async function PATCH(req: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;
  const access = await requireBookingOpsApiAccess(auth.session, context.params.id);
  if (!access.ok) return access.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: 'Некорректный JSON.' }, { status: 400 });
  }

  const parsed = parseUpdateBookingOpsTaskInput(body);
  if (!parsed.ok) {
    const message =
      parsed.error === 'invalid_status'
        ? 'Недопустимый статус задачи.'
        : parsed.error === 'invalid_priority'
          ? 'Недопустимый приоритет задачи.'
          : 'Нет полей для обновления.';
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }

  const expectedScope = { accountId: access.accountId, propertyId: access.propertyId };
  try {
    await requireBookingOpsRecordScope(access.bookingId, expectedScope);
  } catch {
    return NextResponse.json({ ok: false, message: 'booking_scope_mismatch' }, { status: 403 });
  }

  let result;
  try {
    result = await updateBookingOpsTaskWithCompletionEffects(
      access.bookingId,
      context.params.taskId,
      parsed.input,
      undefined,
      expectedScope,
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'booking_scope_mismatch') {
      return NextResponse.json({ ok: false, message: error.message }, { status: 403 });
    }
    throw error;
  }
  if (!result.ok) {
    const status = result.error === 'not_found'
      ? 404
      : result.error === 'telegram_drafts_missing'
        ? 409
        : 500;
    return NextResponse.json(
      { ok: false, message: result.message, effectResult: result.effectResult },
      { status },
    );
  }

  const [record, tasksResult] = await Promise.all([
    requireBookingOpsRecordScope(access.bookingId, expectedScope),
    listBookingOpsTasksForRecord(access.bookingId, { expectedScope }),
  ]);
  if (record && tasksResult.ok) {
    await syncBookingOpsCommunications({
      record,
      tasks: tasksResult.tasks,
      expectedScope,
    });
  }

  return NextResponse.json({
    ok: true,
    task: result.task,
    effectResult: result.effectResult,
    message: result.effectResult?.message ?? 'Статус задачи обновлён.',
  });
}
