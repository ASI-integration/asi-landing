import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { getOpsOperatorTask, updateOpsOperatorTask } from '@/lib/ops-board/repository';
import { emitOpsTaskStatusEvent } from '@/lib/ops-board/crm-events';
import { OPS_TASK_STATUSES, type OpsTaskStatus } from '@/lib/ops-board/types';

export const dynamic = 'force-dynamic';

type RouteParams = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: RouteParams): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: 'Некорректный запрос.' }, { status: 400 });
  }

  const taskStatus = String(body.taskStatus ?? '');
  if (!OPS_TASK_STATUSES.includes(taskStatus as OpsTaskStatus)) {
    return NextResponse.json({ ok: false, message: 'Укажите статус задачи.' }, { status: 400 });
  }

  const existing = await getOpsOperatorTask(id);
  if (!existing.ok || !existing.task) {
    return NextResponse.json({ ok: false, message: 'Задача не найдена.' }, { status: 404 });
  }

  const lastEventText = typeof body.lastEventText === 'string' ? body.lastEventText : undefined;
  const result = await updateOpsOperatorTask(id, {
    taskStatus: taskStatus as OpsTaskStatus,
    lastEventText,
  });

  if (!result.ok || !result.task) {
    return NextResponse.json({ ok: false, message: 'Не удалось обновить задачу.' }, { status: 500 });
  }

  await emitOpsTaskStatusEvent({
    contactId: result.task.contactId,
    taskId: result.task.id,
    taskType: result.task.taskType,
    taskStatus: result.task.taskStatus,
    title: result.task.title,
  });

  return NextResponse.json({ ok: true, task: result.task });
}
