import { NextResponse } from 'next/server';
import { getRuntimeBridgeClientId, isRuntimeBridgeAuthorized } from '@/lib/asi-runtime/bridge-auth';
import { runRuntimeBridgeRunnerOperation, RuntimeBridgeError } from '@/lib/asi-runtime/bridge-repository';
import { parseRuntimeBridgeRunnerInput, readRuntimeBridgeBody } from '@/lib/asi-runtime/bridge-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function response(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isRuntimeBridgeAuthorized(request, 'runner')) return response({ ok: false, error: 'unauthorized' }, 401);
  const clientId = getRuntimeBridgeClientId();
  if (!clientId) return response({ ok: false, error: 'bridge_not_configured' }, 503);
  const parsed = parseRuntimeBridgeRunnerInput(await readRuntimeBridgeBody(request));
  if (!parsed) return response({ ok: false, error: 'invalid_request' }, 400);
  try {
    return response({ ok: true, operation: parsed.operation, data: await runRuntimeBridgeRunnerOperation(clientId, parsed) });
  } catch (error) {
    if (error instanceof RuntimeBridgeError) return response({ ok: false, error: error.code }, error.status);
    return response({ ok: false, error: 'runtime_bridge_error' }, 500);
  }
}
