import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import {
  createOpsOperatorTask,
  listOpsOperatorTasks,
  type ListOpsOperatorTasksFilter,
} from '@/lib/ops-board/repository';
import { emitOpsTaskCreatedEvent } from '@/lib/ops-board/crm-events';
import {
  OPS_TASK_PRIORITIES,
  OPS_TASK_SOURCES,
  OPS_TASK_STATUSES,
  OPS_TASK_TYPES,
  type OpsTaskStatus,
  type OpsTaskType,
} from '@/lib/ops-board/types';

export const dynamic = 'force-dynamic';

function parseStatus(raw: string | null): ListOpsOperatorTasksFilter['status'] {
  if (!raw || raw === 'all') return 'all';
  if (raw === 'open') return 'open';
  return OPS_TASK_STATUSES.includes(raw as OpsTaskStatus) ? (raw as OpsTaskStatus) : 'open';
}

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  const url = new URL(req.url);
  const status = parseStatus(url.searchParams.get('status'));
  const urgentOnly = url.searchParams.get('urgentOnly') === '1';

  const result = await listOpsOperatorTasks({ status, urgentOnly });
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: 'Не удалось загрузить задачи.' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    tasks: result.tasks,
    refreshedAt: new Date().toISOString(),
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: 'Некорректный запрос.' }, { status: 400 });
  }

  const taskType = String(body.taskType ?? '');
  if (!OPS_TASK_TYPES.includes(taskType as OpsTaskType)) {
    return NextResponse.json({ ok: false, message: 'Укажите тип задачи.' }, { status: 400 });
  }

  const source = String(body.source ?? 'manual');
  if (!OPS_TASK_SOURCES.includes(source as (typeof OPS_TASK_SOURCES)[number])) {
    return NextResponse.json({ ok: false, message: 'Укажите источник задачи.' }, { status: 400 });
  }

  const priority = String(body.priority ?? 'normal');
  if (!OPS_TASK_PRIORITIES.includes(priority as (typeof OPS_TASK_PRIORITIES)[number])) {
    return NextResponse.json({ ok: false, message: 'Укажите приоритет.' }, { status: 400 });
  }

  const result = await createOpsOperatorTask({
    taskType: taskType as OpsTaskType,
    source: source as (typeof OPS_TASK_SOURCES)[number],
    priority: priority as (typeof OPS_TASK_PRIORITIES)[number],
    title: typeof body.title === 'string' ? body.title : undefined,
    description: typeof body.description === 'string' ? body.description : null,
    objectId: typeof body.objectId === 'string' ? body.objectId : null,
    contactId: typeof body.contactId === 'string' ? body.contactId : null,
    guestName: typeof body.guestName === 'string' ? body.guestName : null,
    ownerName: typeof body.ownerName === 'string' ? body.ownerName : null,
    objectLabel: typeof body.objectLabel === 'string' ? body.objectLabel : null,
    lastEventText: typeof body.lastEventText === 'string' ? body.lastEventText : null,
  });

  if (!result.ok || !result.task) {
    return NextResponse.json({ ok: false, message: 'Не удалось создать задачу.' }, { status: 500 });
  }

  if (result.created) {
    await emitOpsTaskCreatedEvent({
      contactId: result.task.contactId,
      taskId: result.task.id,
      taskType: result.task.taskType,
      title: result.task.title,
      source: result.task.source,
      objectId: result.task.objectId,
    });
  }

  return NextResponse.json({ ok: true, task: result.task, created: result.created }, { status: result.created ? 201 : 200 });
}
