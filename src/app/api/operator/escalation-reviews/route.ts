import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getOperatorReviewStoreHealth, listEscalationReviews } from '@/lib/communication/operator-review';

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

  // A corrupted/unreadable store must never be reported as a truthful
  // empty list — fail closed with an explicit 503 instead.
  if (getOperatorReviewStoreHealth() === 'unavailable') {
    return NextResponse.json({ ok: false, error: 'operator_review_store_unavailable' }, { status: 503 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') ?? undefined;
  const limitRaw = searchParams.get('limit');
  const limit = limitRaw ? Number(limitRaw) : undefined;

  const reviews = listEscalationReviews({
    status: status ? (status as any) : undefined,
    limit: Number.isFinite(limit) ? limit : undefined,
  });

  return NextResponse.json({ ok: true, reviews });
}

