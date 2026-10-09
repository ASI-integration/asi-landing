import { NextResponse } from 'next/server';
import { requireCrmOperatorSession, requireOpsAdminSession } from '@/lib/crm/api-auth';
import { crmOperatorAllowlist, opsAdminAllowlist } from '@/lib/crm/access';
import { HANDOFF_UUID, parseHandoffRequest, readHandoffBody } from '@/lib/crm/operator-handoff';
import { transitionOperatorHandoff } from '@/lib/crm/operator-handoff-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const denied = (code: string, status: number) =>
  NextResponse.json({ ok: false, code }, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req: Request): Promise<NextResponse> {
  try {
    // Every attempt, including replay, must reacquire trusted iron-session auth.
    const auth = await requireCrmOperatorSession().catch(() => ({ error: denied('UNAUTHENTICATED', 401) }));
    if ('error' in auth) return auth.error;
    const actorId = auth.session.userId;
    const email = String(auth.session.email ?? '').trim().toLowerCase();
    // No development shortcut or production domain fallback for this mutation boundary.
    if (!HANDOFF_UUID.test(actorId) || !crmOperatorAllowlist().has(email)) return denied('DENIED', 403);
    // Production session cookies are SameSite=None: require an exact browser Origin.
    if (req.headers.get('origin') !== new URL(req.url).origin ||
        req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return denied('DENIED', 403);
    }
    let raw: unknown;
    try { raw = await readHandoffBody(req); } catch { return denied('INVALID_REQUEST', 400); }
    const request = parseHandoffRequest(raw);
    if (!request) return denied('INVALID_REQUEST', 400);
    if (['assign', 'reassign', 'close'].includes(request.action)) {
      const admin = await requireOpsAdminSession().catch(() => ({ error: denied('UNAUTHENTICATED', 401) }));
      if ('error' in admin) return admin.error;
      if (admin.session.userId !== actorId || String(admin.session.email).trim().toLowerCase() !== email ||
          !opsAdminAllowlist().has(email)) return denied('DENIED', 403);
    }
    const result = await transitionOperatorHandoff(actorId.toLowerCase(), request);
    if (!result.ok) return denied(result.code, result.status);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    // Never leak session/DB exception messages or imply the commit did not happen.
    return denied('RECONCILIATION_REQUIRED', 503);
  }
}
