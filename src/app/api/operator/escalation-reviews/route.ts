import { NextRequest, NextResponse } from 'next/server';
import { listEscalationReviews } from '@/lib/communication/operator-review';
import {
  requireOperatorCommunicationScope,
  resolveEscalationReviewAccountIds,
} from '@/lib/communication/operator-access';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const scope = await requireOperatorCommunicationScope();
  if ('error' in scope) return scope.error;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') ?? undefined;
  const limitRaw = searchParams.get('limit');
  const requestedLimit = limitRaw ? Number(limitRaw) : 200;
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 200;

  const candidates = listEscalationReviews({
    status: status ? (status as any) : undefined,
    limit: Number.MAX_SAFE_INTEGER,
  });
  const resolution = await resolveEscalationReviewAccountIds(candidates);
  if (!resolution.ok) {
    // Tenant resolution itself failed (not "no reviews") — fail closed
    // rather than silently returning an empty-but-200 list.
    return NextResponse.json({ ok: false, error: 'tenant_resolution_failed' }, { status: 503 });
  }
  const reviews = candidates
    .filter((review) => {
      const accountId = resolution.resolved.get(review.reviewId);
      return Boolean(accountId && scope.accountIds.has(accountId));
    })
    .slice(0, limit);

  return NextResponse.json({ ok: true, reviews });
}

