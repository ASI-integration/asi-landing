import { handleRuntimeBridgeChatRequest } from '../route';
import { RUNTIME_BRIDGE_CHAT_OPERATIONS } from '@/lib/asi-runtime/bridge-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  context: { params: { operation: string } },
) {
  if (!RUNTIME_BRIDGE_CHAT_OPERATIONS.includes(
    context.params.operation as typeof RUNTIME_BRIDGE_CHAT_OPERATIONS[number],
  )) {
    return Response.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  return handleRuntimeBridgeChatRequest(request, context.params.operation);
}
