import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { listEscalationReviews } from '@/lib/communication/operator-review';
import { resolveOperatorReviewAccountScope } from '@/lib/communication/operator-review-access';

export const dynamic = 'force-dynamic';

async function requireSession() {
  const session = await getSession();
  if (!session.userId) return null;
  return session;
}

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') ?? undefined;
  const limitRaw = searchParams.get('limit');
  const limit = limitRaw ? Number(limitRaw) : undefined;

  try {
    const accountScope = await resolveOperatorReviewAccountScope(session.userId);
    const reviews = listEscalationReviews({
      status: status ? (status as any) : undefined,
      limit: Number.isFinite(limit) ? limit : undefined,
      accountIds: [...accountScope],
    });
    return NextResponse.json({ ok: true, reviews });
  } catch {
    return NextResponse.json({ ok: false, error: 'account_scope_unavailable' }, { status: 503 });
  }
}

