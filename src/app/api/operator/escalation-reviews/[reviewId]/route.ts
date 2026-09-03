import { NextRequest, NextResponse } from 'next/server';
import {
  approveEscalationReview,
  closeEscalationReview,
  getEscalationReview,
  getReviewsBySessionId,
} from '@/lib/communication/operator-review';
import {
  lockSessionForOperator,
  releaseSessionToAi,
  resolveOperatorHandoffWithReply,
} from '@/lib/communication/handoff-lock';
import {
  requireEscalationReviewScope,
  requireOperatorCommunicationScope,
} from '@/lib/communication/operator-access';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: { reviewId: string } }) {
  const scope = await requireOperatorCommunicationScope();
  if ('error' in scope) return scope.error;

  const review = getEscalationReview(ctx.params.reviewId);
  if (!review) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  const reviewScope = await requireEscalationReviewScope(scope, review);
  if ('error' in reviewScope) return reviewScope.error;

  return NextResponse.json({ ok: true, review });
}

export async function PATCH(req: NextRequest, ctx: { params: { reviewId: string } }) {
  const scope = await requireOperatorCommunicationScope();
  if ('error' in scope) return scope.error;

  const reviewId = ctx.params.reviewId;
  const existing = getEscalationReview(reviewId);
  if (!existing) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }
  const reviewScope = await requireEscalationReviewScope(scope, existing);
  if ('error' in reviewScope) return reviewScope.error;
  const sessionReviews = getReviewsBySessionId(existing.sessionId);
  for (const sessionReview of sessionReviews) {
    const sessionReviewScope = await requireEscalationReviewScope(scope, sessionReview);
    if ('error' in sessionReviewScope || sessionReviewScope.accountId !== reviewScope.accountId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const action = String(body.action ?? '');
  const operatorId = scope.session.userId;

  try {
    if (action === 'acknowledge') {
      const chatId = Number(existing.targetId);
      const { review } = lockSessionForOperator({
        reviewId,
        operatorId,
        chatId: Number.isFinite(chatId) ? chatId : undefined,
      });
      return NextResponse.json({ ok: true, review });
    }
    if (action === 'approve') {
      const review = approveEscalationReview(reviewId, operatorId);
      return NextResponse.json({ ok: true, review });
    }
    if (action === 'close') {
      const review = closeEscalationReview(reviewId, operatorId);
      return NextResponse.json({ ok: true, review });
    }
    if (action === 'send_reply') {
      const replyText = String(body.replyText ?? '');
      const result = await resolveOperatorHandoffWithReply({ reviewId, operatorId, replyText });
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.error ?? 'send_failed' }, { status: 400 });
      }
      return NextResponse.json({
        ok: true,
        review: result.review,
        releaseState: result.state,
        duplicatePrevented: result.duplicatePrevented,
      });
    }
    if (action === 'return_to_ai') {
      const chatId = Number(existing.targetId);
      const release = releaseSessionToAi({
        sessionId: existing.sessionId,
        operatorId,
        reason: 'manual_return_to_ai',
        chatId: Number.isFinite(chatId) ? chatId : undefined,
      });
      const reviews = getReviewsBySessionId(existing.sessionId).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      return NextResponse.json({
        ok: true,
        release,
        review: reviews[0] ?? null,
      });
    }

    return NextResponse.json({ ok: false, error: 'unknown_action' }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

