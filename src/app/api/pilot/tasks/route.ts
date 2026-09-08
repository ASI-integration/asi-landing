import { NextResponse } from 'next/server';
import { requirePilotBetaSession } from '@/lib/pilot/api-auth';
import { listPilotTasksForUser, PilotAccessError } from '@/lib/pilot/task-access';
import { submitPilotTask } from '@/lib/pilot/task-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

/** List only the authenticated pilot user's tasks. */
export async function GET() {
  const auth = await requirePilotBetaSession();
  if ('error' in auth) return auth.error;

  try {
    const tasks = await listPilotTasksForUser(auth.session.userId!);
    return json({ ok: true, tasks });
  } catch (error) {
    if (error instanceof PilotAccessError) {
      return json({ ok: false, code: error.code, message: error.messageRu }, error.status);
    }
    return json({ ok: false, message: 'Не удалось получить задачи пилота.' }, 500);
  }
}

/**
 * SP-02: create a green-path pilot task via the existing Bridge submit seam.
 * Client body: { goal, title?, idempotencyKey }. Server owns envelope/policy/repo.
 */
export async function POST(request: Request) {
  const auth = await requirePilotBetaSession();
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

  try {
    const result = await submitPilotTask({
      pilotUserId: auth.session.userId!,
      body: body as Record<string, unknown>,
    });

    return json({
      ok: true,
      taskId: result.task.taskId,
      deduplicated: result.deduplicated,
      templateId: result.template.templateId,
      task: {
        taskId: result.task.taskId,
        title: result.task.title,
        status: result.task.status,
        consoleStatus: result.task.consoleStatus,
        repository: result.task.repository,
        createdAt: result.task.createdAt,
        updatedAt: result.task.updatedAt,
      },
    });
  } catch (error) {
    if (error instanceof PilotAccessError) {
      return json({ ok: false, code: error.code, message: error.messageRu }, error.status);
    }
    return json({ ok: false, message: 'Не удалось создать задачу пилота.' }, 500);
  }
}
