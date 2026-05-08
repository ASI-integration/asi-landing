import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { resolveAccountIdForUser } from '@/lib/accounts';
import type { OperationsRepositoryContext } from './repository';
import { OperationsRepositoryUnavailableError } from './repository';

export type OperationsApiContext =
  | { ok: true; ctx: OperationsRepositoryContext }
  | { ok: false; response: NextResponse };

export async function requireOperationsContext(): Promise<OperationsApiContext> {
  let session: Awaited<ReturnType<typeof getSession>>;
  try {
    session = await getSession();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: 'operations_backend_unavailable', detail }, { status: 503 }),
    };
  }

  if (!session.userId) {
    return { ok: false, response: NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }) };
  }

  try {
    const accountId = await resolveAccountIdForUser(session.userId);
    if (!accountId || accountId === 'legacy') {
      return {
        ok: false,
        response: NextResponse.json(
          { ok: false, error: 'operations_backend_unavailable', detail: 'account_workspace_unavailable' },
          { status: 503 },
        ),
      };
    }

    return {
      ok: true,
      ctx: {
        accountId,
        userId: session.userId,
      },
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: 'operations_backend_unavailable', detail }, { status: 503 }),
    };
  }
}

export function operationsApiErrorResponse(err: unknown): NextResponse {
  if (err instanceof OperationsRepositoryUnavailableError) {
    return NextResponse.json(
      { ok: false, error: 'operations_backend_unavailable', detail: err.message },
      { status: 503 },
    );
  }

  const detail = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ ok: false, error: 'operations_request_failed', detail }, { status: 500 });
}

export async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await req.json()) as unknown;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return {};
    return body as Record<string, unknown>;
  } catch {
    return {};
  }
}
