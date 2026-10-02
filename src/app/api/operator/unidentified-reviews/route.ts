import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { canReviewUnidentified, listUnidentifiedReviews, actOnUnidentifiedReview } from '@/lib/communication/unidentified-review';
export const dynamic = 'force-dynamic';
export async function GET() {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canReviewUnidentified(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try { return NextResponse.json({ ok: true, items: listUnidentifiedReviews() }); }
  catch { return NextResponse.json({ error: 'review_store_unavailable' }, { status: 503 }); }
}
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!canReviewUnidentified(session)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'invalid_request' }, { status: 400 }); }
  if (!body || typeof body !== 'object' || Object.keys(body).some((key) => !['reviewId', 'action'].includes(key))
    || typeof body.reviewId !== 'string'
    || !['acknowledge', 'request_identity'].includes(String(body.action))) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  try {
    const result = await actOnUnidentifiedReview({ reviewId: body.reviewId, operatorId: session.userId,
      action: body.action as 'acknowledge' | 'request_identity' });
    return NextResponse.json(result, { status: result.ok ? 200 : result.error === 'not_found' ? 404 : 502 });
  } catch { return NextResponse.json({ error: 'review_store_unavailable' }, { status: 503 }); }
}
