import { NextResponse } from 'next/server';
import { requireCrmOperatorSession, requireOpsAdminSession } from '@/lib/crm/api-auth';
import { getBookingOpsRecord } from '@/lib/booking-ops/repository';
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

  const result = await listBookingOpsTasksForRecord(context.params.id);
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, message: result.error ?? 'Не удалось загрузить задачи.' },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true, tasks: result.tasks });
}

export async function POST(req: Request, context: RouteContext): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;

  const record = await getBookingOpsRecord(context.params.id);
  if (!record) {
    return NextResponse.json({ ok: false, message: 'Запись не найдена.' }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: 'Некорректный JSON.' }, { status: 400 });
  }

  const parsed = parseCreateManualBookingOpsTaskInput(body, context.params.id);
  if (!parsed.ok) {
    return NextResponse.json(
      { ok: false, message: 'Недопустимый тип задачи.' },
      { status: 400 },
    );
  }

  const input = {
    ...parsed.input,
    bookingId: parsed.input.bookingId ?? record.bookingId,
    title: parsed.input.title || BOOKING_OPS_TASK_TYPE_LABELS_RU[parsed.input.taskType],
    source: 'manual' as const,
  };

  const result = await createBookingOpsTask(input);
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
}
