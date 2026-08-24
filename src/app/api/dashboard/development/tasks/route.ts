import { NextResponse } from 'next/server';
import { requireDevelopmentOwnerSession } from '@/lib/development/api-auth';
import { listDevelopmentRepositories } from '@/lib/development/repositories';
import { getDevelopmentReadiness } from '@/lib/development/readiness';
import {
  DevelopmentConsoleError,
  listDevelopmentTasksForOwner,
  submitDevelopmentTask,
} from '@/lib/development/task-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function GET() {
  const auth = await requireDevelopmentOwnerSession();
  if ('error' in auth) return auth.error;

  return json({
    ok: true,
    repositories: listDevelopmentRepositories(),
    recentTasks: await listDevelopmentTasksForOwner(auth.session.userId!),
  });
}

export async function POST(request: Request) {
  const auth = await requireDevelopmentOwnerSession();
  if ('error' in auth) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: 'Некорректный JSON.' }, 400);
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ ok: false, message: 'Некорректный запрос.' }, 400);
  }

  const payload = body as Record<string, unknown>;

  try {
    const readiness = await getDevelopmentReadiness();
    if (!readiness.canLaunch) {
      return json({
        ok: false,
        code: 'readiness_blocked',
        message: 'Запуск остановлен до устранения обязательных блокеров.',
      }, 503);
    }
  } catch {
    return json({
      ok: false,
      code: 'readiness_unavailable',
      message: 'Не удалось подтвердить готовность к запуску.',
    }, 503);
  }

  try {
    const result = await submitDevelopmentTask({
      ownerUserId: auth.session.userId!,
      repositoryId: payload.repositoryId,
      prompt: payload.prompt,
      title: payload.title,
      objective: payload.objective,
      instructions: payload.instructions,
      idempotencyKey: payload.idempotencyKey,
      baselineSha: payload.baselineSha,
    });

    return json({
      ok: true,
      taskId: result.snapshot.task.taskId,
      deduplicated: result.deduplicated,
      task: result.snapshot.task,
      result: result.snapshot.result,
      pendingGates: result.snapshot.pendingGates,
      mergeGate: result.snapshot.mergeGate,
    });
  } catch (error) {
    if (error instanceof DevelopmentConsoleError) {
      console.warn('[development-console] submit failed', { code: error.code, status: error.status });
      return json({ ok: false, message: error.messageRu, code: error.code }, error.status);
    }
    console.warn('[development-console] submit unexpected error');
    return json({ ok: false, message: 'Не удалось создать задачу.' }, 500);
  }
}
