import { NextResponse } from 'next/server';
import { requireBookingOpsApiAccess } from '../../access';
import { requireCrmOperatorSession, requireOpsAdminSession } from '@/lib/crm/api-auth';
import { requireBookingOpsRecordScope } from '@/lib/booking-ops/repository';
import {
  createBookingOpsTask,
  listBookingOpsTasksForRecord,
  parseCreateManualBookingOpsTaskInput,
} from '@/lib/booking-ops/tasks';
import { BOOKING_OPS_TASK_TYPE_LABELS_RU } from '@/lib/booking-ops/task-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: { id: string } };

export async function GET(_req: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;
  const access = await requireBookingOpsApiAccess(auth.session, context.params.id);
  if (!access.ok) return access.response;

  const expectedScope = { accountId: access.accountId, propertyId: access.propertyId };
  try {
    const result = await listBookingOpsTasksForRecord(access.bookingId, { expectedScope });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, message: result.error ?? 'Не удалось загрузить задачи.' },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true, tasks: result.tasks });
  } catch (error) {
    if (error instanceof Error && error.message === 'booking_scope_mismatch') {
      return NextResponse.json({ ok: false, message: 'Нет доступа к бронированию.' }, { status: 403 });
    }
    return NextResponse.json({ ok: false, message: 'Не удалось загрузить задачи.' }, { status: 500 });
  }
}

export async function POST(req: Request, context: RouteContext): Promise<NextResponse> {
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

  const parsed = parseCreateManualBookingOpsTaskInput(body, access.bookingId);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, message: 'Недопустимый тип задачи.' },
      { status: 400 },
    );
  }

  const expectedScope = { accountId: access.accountId, propertyId: access.propertyId };
  try {
    const record = await requireBookingOpsRecordScope(access.bookingId, expectedScope);
    const input = {
      ...parsed.input,
      bookingId: record.bookingId,
      title: parsed.input.title || BOOKING_OPS_TASK_TYPE_LABELS_RU[parsed.input.taskType],
      source: 'manual' as const,
    };

    const result = await createBookingOpsTask(input, { expectedScope });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, message: result.error ?? 'Не удалось создать задачу.' },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { ok: true, task: result.task, created: result.created },
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    const status = code === 'booking_scope_mismatch' ? 403 : code === 'booking_not_found' ? 404 : 409;
    return NextResponse.json({ ok: false, message: 'Не удалось подтвердить область бронирования.' }, { status });
  }
}
