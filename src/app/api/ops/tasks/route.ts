import { NextResponse } from 'next/server';
import { isOpsAdminEmail } from '@/lib/crm/access';
import { requireCrmOperatorSession, requireOpsAdminSession } from '@/lib/crm/api-auth';
import { createOpsV1Task, listOpsV1Tasks } from '@/lib/ops-v1/repository';
import { OPS_V1_TASK_TYPES, type OpsV1TaskType } from '@/lib/ops-v1/types';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  const result = await listOpsV1Tasks({ syncAuto: true });
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: 'Не удалось загрузить задачи.' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    tasks: result.tasks,
    summary: result.summary,
    refreshedAt: new Date().toISOString(),
    isOpsAdmin: isOpsAdminEmail(auth.session.email),
    autoSync: result.autoSync ?? null,
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await requireOpsAdminSession();
  if ('error' in auth) return auth.error;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, message: 'Некорректный запрос.' }, { status: 400 });
  }

  const taskType = String(body.taskType ?? '');
  if (!OPS_V1_TASK_TYPES.includes(taskType as OpsV1TaskType)) {
    return NextResponse.json({ ok: false, message: 'Укажите тип задачи.' }, { status: 400 });
  }

  const result = await createOpsV1Task({
    taskType: taskType as OpsV1TaskType,
    objectLabel: typeof body.objectLabel === 'string' ? body.objectLabel : null,
    propertyId: typeof body.propertyId === 'string' ? body.propertyId : null,
    comment: typeof body.comment === 'string' ? body.comment : null,
    scheduledAt: typeof body.scheduledAt === 'string' ? body.scheduledAt : null,
  });

  if (!result.ok || !result.task) {
    return NextResponse.json({ ok: false, message: 'Не удалось создать задачу.' }, { status: 500 });
  }

  return NextResponse.json(
    { ok: true, task: result.task, created: result.created },
    { status: result.created ? 201 : 200 },
  );
}
