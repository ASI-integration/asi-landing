import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { resolveAccountIdForUser } from '@/lib/accounts';
import { listEscalationReviewsForAccount } from '@/lib/communication/operator-review';

export const dynamic = 'force-dynamic';

async function requireAccount() {
  const session = await getSession();
  if (!session.userId) return { ok: false as const, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  const accountId = await resolveAccountIdForUser(session.userId);
  if (!accountId || accountId === 'legacy') {
    return { ok: false as const, response: NextResponse.json({ error: 'account_workspace_unavailable' }, { status: 403 }) };
  }
  return { ok: true as const, session, accountId };
}

export async function GET(req: NextRequest) {
  const auth = await requireAccount();
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') ?? undefined;
  const limitRaw = searchParams.get('limit');
  const limit = limitRaw ? Number(limitRaw) : undefined;

  try {
    const reviews = listEscalationReviewsForAccount(auth.accountId, {
      status: status ? (status as any) : undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return NextResponse.json({ ok: true, reviews });
  } catch (error) {
    if (error instanceof Error && error.message === 'operator_review_store_unhealthy') {
      return NextResponse.json({ ok: false, error: 'operator_review_store_unhealthy' }, { status: 503 });
    }
    throw error;
  }
}
