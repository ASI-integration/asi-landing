import { NextResponse } from 'next/server';
import { requireDevelopmentOwnerSession } from '@/lib/development/api-auth';
import {
  DevelopmentConsoleError,
  submitDevelopmentOwnerDecision,
} from '@/lib/development/task-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

type RouteContext = { params: { taskId: string } };

export async function POST(request: Request, context: RouteContext) {
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
    const result = await submitDevelopmentOwnerDecision({
      taskId: context.params.taskId,
      gateId: payload.gateId,
      taskCycle: payload.taskCycle,
      decision: payload.decision,
      note: payload.note,
    });

    return json({
      ok: true,
      deduplicated: result.deduplicated,
      task: result.snapshot.task,
      result: result.snapshot.result,
      pendingGates: result.snapshot.pendingGates,
    });
  } catch (error) {
    if (error instanceof DevelopmentConsoleError) {
      console.warn('[development-console] decision failed', { code: error.code, status: error.status });
      return json({ ok: false, message: error.messageRu, code: error.code }, error.status);
    }
    console.warn('[development-console] decision unexpected error');
    return json({ ok: false, message: 'Не удалось отправить решение.' }, 500);
  }
}
