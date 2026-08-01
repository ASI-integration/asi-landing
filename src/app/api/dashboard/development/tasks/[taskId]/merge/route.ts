import { NextResponse } from 'next/server';
import { requireDevelopmentOwnerSession } from '@/lib/development/api-auth';
import {
  DevelopmentConsoleError,
  submitDevelopmentMergeRequest,
} from '@/lib/development/task-service';
import { CONTROL_CENTER_OWNER_GATE_MERGE_BLOCK_PASSED } from '@/lib/development/owner-merge-gate';

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
    const outcome = await submitDevelopmentMergeRequest({
      ownerUserId: auth.session.userId!,
      taskId: context.params.taskId,
      pullRequestUrl: payload.pullRequestUrl,
      expectedHeadSha: payload.expectedHeadSha,
    });
    if (!outcome.merged) {
      return json({
        ok: false,
        merged: false,
        deduplicated: outcome.deduplicated,
        gate: outcome.gate,
        blocker: outcome.gate.blocker,
        message: outcome.gate.blocker?.message ?? 'Объединение PR заблокировано.',
      }, 409);
    }
    return json({
      ok: true,
      merged: true,
      deduplicated: outcome.deduplicated,
      mergeCommitSha: outcome.mergeCommitSha,
      gate: outcome.gate,
      marker: CONTROL_CENTER_OWNER_GATE_MERGE_BLOCK_PASSED,
    });
  } catch (error) {
    if (error instanceof DevelopmentConsoleError) {
      console.warn('[development-console] merge blocked', { code: error.code, status: error.status });
      return json({ ok: false, merged: false, message: error.messageRu, code: error.code }, error.status);
    }
    console.warn('[development-console] merge unexpected error');
    return json({ ok: false, merged: false, message: 'Не удалось проверить объединение PR.' }, 500);
  }
}
