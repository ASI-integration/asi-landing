import { NextResponse } from 'next/server';
import { isOpsAdminEmail } from '@/lib/crm/access';
import { requireCrmOperatorSession, requireOpsAdminSession } from '@/lib/crm/api-auth';
import { createOpsV1Task, listOpsV1Tasks } from '@/lib/ops-v1/repository';
import { OPS_V1_TASK_TYPES, type OpsV1ListFilter, type OpsV1TaskType } from '@/lib/ops-v1/types';

export const dynamic = 'force-dynamic';

function logOpsAdminCheck(email: string | null | undefined, isAdmin: boolean): void {
  if (isAdmin) return;
  const normalized = String(email ?? '').trim();
  if (!normalized) {
    console.info('OPS admin check: session email missing');
    return;
  }
  console.info('OPS admin check: not in allowlist');
}

function parseListFilter(raw: string | null): OpsV1ListFilter {
  if (raw === 'done' || raw === 'all') return raw;
  return 'active';
}

export async function GET(req: Request): Promise<NextResponse> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth.error;

  const url = new URL(req.url);
  const filter = parseListFilter(url.searchParams.get('filter'));
  const includeTest = url.searchParams.get('includeTest') === '1';

  const result = await listOpsV1Tasks({ syncAuto: true, filter, includeTest });
  const isOpsAdmin = isOpsAdminEmail(auth.session.email);
  logOpsAdminCheck(auth.session.email, isOpsAdmin);

  return NextResponse.json({
    ok: true,
    tasks: result.tasks,
    summary: result.summary,
    filter,
    refreshedAt: new Date().toISOString(),
    isOpsAdmin,
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
