import { NextResponse } from 'next/server';
import { requirePilotBetaSession } from '@/lib/pilot/api-auth';
import { getPilotTaskDetailForUser, PilotAccessError } from '@/lib/pilot/task-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

type RouteContext = { params: { taskId: string } };

/**
 * SP-04: get one owned task with normalized console status + safe result.
 * Cross-user access returns 404. No merge/deploy.
 */
export async function GET(_request: Request, context: RouteContext) {
  const auth = await requirePilotBetaSession();
  if ('error' in auth) return auth.error;

  const taskId = context.params.taskId;

  try {
    const detail = await getPilotTaskDetailForUser(taskId, auth.session.userId!);
    return json({
      ok: true,
      task: {
        taskId: detail.task.taskId,
        title: detail.task.title,
        status: detail.task.status,
        consoleStatus: detail.task.consoleStatus,
        repository: detail.task.repository,
        createdAt: detail.task.createdAt,
        updatedAt: detail.task.updatedAt,
      },
      result: detail.result,
    });
  } catch (error) {
    if (error instanceof PilotAccessError) {
      return json({ ok: false, code: error.code, message: error.messageRu }, error.status);
    }
    return json({ ok: false, message: 'Не удалось получить задачу пилота.' }, 500);
  }
}
