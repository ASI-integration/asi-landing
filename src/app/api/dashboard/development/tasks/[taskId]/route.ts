import { NextResponse } from 'next/server';
import { requireDevelopmentOwnerSession } from '@/lib/development/api-auth';
import {
  buildDevelopmentTaskSnapshot,
  DevelopmentConsoleError,
} from '@/lib/development/task-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

type RouteContext = { params: { taskId: string } };

export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireDevelopmentOwnerSession();
  if ('error' in auth) return auth.error;

  try {
    const snapshot = await buildDevelopmentTaskSnapshot(context.params.taskId);
    return json({
      ok: true,
      task: snapshot.task,
      result: snapshot.result,
      pendingGates: snapshot.pendingGates,
    });
  } catch (error) {
    if (error instanceof DevelopmentConsoleError) {
      console.warn('[development-console] get task failed', { code: error.code, status: error.status });
      return json({ ok: false, message: error.messageRu, code: error.code }, error.status);
    }
    console.warn('[development-console] get task unexpected error');
    return json({ ok: false, message: 'Не удалось получить задачу.' }, 500);
  }
}
