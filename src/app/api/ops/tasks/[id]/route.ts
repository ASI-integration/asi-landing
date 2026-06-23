import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { getOpsOperatorTask, updateOpsOperatorTask } from '@/lib/ops-board/repository';
import { emitOpsTaskStatusEvent } from '@/lib/ops-board/crm-events';
import { mapOperatorTaskToV1, mapV1StatusToOperator } from '@/lib/ops-v1/mapping';
import { syncAutoOpsTasks } from '@/lib/ops-v1/auto-tasks';
import { OPS_V1_STATUSES, type OpsV1Status } from '@/lib/ops-v1/types';

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

  const status = String(body.status ?? '');
  if (!OPS_V1_STATUSES.includes(status as OpsV1Status)) {
    return NextResponse.json({ ok: false, message: 'Укажите статус задачи.' }, { status: 400 });
  }

  const existing = await getOpsOperatorTask(id);
  if (!existing.ok || !existing.task) {
    return NextResponse.json({ ok: false, message: 'Задача не найдена.' }, { status: 404 });
  }

  const result = await updateOpsOperatorTask(id, {
    taskStatus: mapV1StatusToOperator(status as OpsV1Status),
  });

  if (!result.ok || !result.task) {
    return NextResponse.json({ ok: false, message: 'Не удалось обновить задачу.' }, { status: 500 });
  }

  const task = mapOperatorTaskToV1(result.task);

  await emitOpsTaskStatusEvent({
    contactId: result.task.contactId,
    taskId: task.id,
    taskType: result.task.taskType,
    taskStatus: result.task.taskStatus,
    title: task.title,
  });

  void syncAutoOpsTasks().catch((error) => {
    console.warn('[ops-v1] auto sync after task update failed', error);
  });

  return NextResponse.json({ ok: true, task });
}
