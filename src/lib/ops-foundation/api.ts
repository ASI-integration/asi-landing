import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { resolveAccountIdForUser } from '@/lib/accounts';
import type { OpsFoundationContext } from './types';
import { OpsFoundationUnavailableError } from './repository';

export type OpsFoundationApiContext =
  | { ok: true; ctx: OpsFoundationContext }
  | { ok: false; response: NextResponse };

export async function requireOpsFoundationContext(): Promise<OpsFoundationApiContext> {
  let session: Awaited<ReturnType<typeof getSession>>;
  try {
    session = await getSession();
  } catch (err) {
    const detail = describeUnknownError(err);
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: 'ops_backend_unavailable', detail }, { status: 503 }),
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
          { ok: false, error: 'ops_backend_unavailable', detail: 'account_workspace_unavailable' },
          { status: 503 },
        ),
      };
    }

    return {
      ok: true,
      ctx: { accountId, userId: session.userId },
    };
  } catch (err) {
    const detail = describeUnknownError(err);
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: 'ops_backend_unavailable', detail }, { status: 503 }),
    };
  }
}

export function describeUnknownError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    const serialized = JSON.stringify(err);
    if (serialized && serialized !== '{}') return serialized;
  } catch {
    // fall through to generic label
  }
  return 'unknown_error';
}

export function opsFoundationApiErrorResponse(err: unknown): NextResponse {
  if (err instanceof OpsFoundationUnavailableError) {
    return NextResponse.json(
      { ok: false, error: 'ops_backend_unavailable', detail: err.message },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { ok: false, error: 'ops_request_failed', detail: describeUnknownError(err) },
    { status: 500 },
  );
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

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function optionalNullableString(value: unknown): string | null | undefined {
  if (value === null) return null;
  return optionalString(value);
}
