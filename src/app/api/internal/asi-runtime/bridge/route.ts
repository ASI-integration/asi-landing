import { NextResponse } from 'next/server';
import { isRuntimeBridgeAuthorized, resolveRuntimeBridgeClientId } from '@/lib/asi-runtime/bridge-auth';
import {
  getRuntimeBridgeResult,
  getRuntimeBridgeTask,
  listRuntimeBridgeOwnerGates,
  listRuntimeBridgeTasks,
  RuntimeBridgeError,
  submitRuntimeBridgeOwnerDecision,
  submitRuntimeBridgeTask,
} from '@/lib/asi-runtime/bridge-repository';
import { parseRuntimeBridgeChatInput, readRuntimeBridgeBody } from '@/lib/asi-runtime/bridge-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function response(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function handleRuntimeBridgeChatRequest(
  request: Request,
  forcedOperation?: string,
): Promise<NextResponse> {
  const requiredRole = forcedOperation === 'runtime_submit_owner_decision' ? 'owner' : 'chat';
  if (!isRuntimeBridgeAuthorized(request, requiredRole)) return response({ ok: false, error: 'unauthorized' }, 401);
  const clientId = resolveRuntimeBridgeClientId();
  if (!clientId) return response({ ok: false, error: 'bridge_not_configured' }, 503);
  const body = await readRuntimeBridgeBody(request);
  const parsed = parseRuntimeBridgeChatInput(forcedOperation ? { operation: forcedOperation, input: body } : body);
  if (!parsed) return response({ ok: false, error: 'invalid_request' }, 400);
  if (!forcedOperation && parsed.operation === 'runtime_submit_owner_decision') {
    return response({ ok: false, error: 'owner_endpoint_required' }, 403);
  }

  try {
    switch (parsed.operation) {
      case 'runtime_submit_task':
        return response({ ok: true, operation: parsed.operation, ...(await submitRuntimeBridgeTask(clientId, parsed.input)) });
      case 'runtime_get_task':
        return response({ ok: true, operation: parsed.operation, task: await getRuntimeBridgeTask(clientId, parsed.input.taskId) });
      case 'runtime_get_result':
        return response({ ok: true, operation: parsed.operation, ...(await getRuntimeBridgeResult(clientId, parsed.input.taskId)) });
      case 'runtime_list_tasks':
        return response({
          ok: true,
          operation: parsed.operation,
          tasks: await listRuntimeBridgeTasks(clientId, parsed.input.conversationId, {
            limit: parsed.input.limit,
          }),
        });
      case 'runtime_list_owner_gates':
        return response({ ok: true, operation: parsed.operation, gates: await listRuntimeBridgeOwnerGates(clientId) });
      case 'runtime_submit_owner_decision':
        return response({ ok: true, operation: parsed.operation, ...(await submitRuntimeBridgeOwnerDecision(clientId, parsed.input)) });
    }
  } catch (error) {
    if (error instanceof RuntimeBridgeError) return response({ ok: false, error: error.code }, error.status);
    return response({ ok: false, error: 'runtime_bridge_error' }, 500);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  return handleRuntimeBridgeChatRequest(request);
}
