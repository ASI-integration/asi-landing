import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { resolveAccountIdForUser } from '@/lib/accounts';
import {
  approveEscalationReview,
  closeEscalationReview,
  getEscalationReviewForAccount,
  getReviewsBySessionIdForAccount,
} from '@/lib/communication/operator-review';
import {
  lockSessionForOperator,
  releaseSessionToAi,
  resolveOperatorHandoffWithReply,
} from '@/lib/communication/handoff-lock';

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

function storeFailureResponse(error: unknown) {
  if (error instanceof Error && error.message === 'operator_review_store_unhealthy') {
    return NextResponse.json({ ok: false, error: 'operator_review_store_unhealthy' }, { status: 503 });
  }
  return null;
}

export async function GET(_req: NextRequest, ctx: { params: { reviewId: string } }) {
  const auth = await requireAccount();
  if (!auth.ok) return auth.response;

  try {
    const review = getEscalationReviewForAccount(ctx.params.reviewId, auth.accountId);
    if (!review) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    return NextResponse.json({ ok: true, review });
  } catch (error) {
    return storeFailureResponse(error) ?? NextResponse.json({ ok: false, error: 'review_read_failed' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: { reviewId: string } }) {
  const auth = await requireAccount();
  if (!auth.ok) return auth.response;

  const reviewId = ctx.params.reviewId;
  let existing;
  try {
    existing = getEscalationReviewForAccount(reviewId, auth.accountId);
  } catch (error) {
    return storeFailureResponse(error) ?? NextResponse.json({ ok: false, error: 'review_read_failed' }, { status: 500 });
  }
  if (!existing) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const action = String(body.action ?? '');
  const operatorId = auth.session.userId;

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
        expectedReviewId: existing.reviewId,
        sessionId: existing.sessionId,
        operatorId,
        reason: 'manual_return_to_ai',
        chatId: Number.isFinite(chatId) ? chatId : undefined,
      });
      const reviews = getReviewsBySessionIdForAccount(existing.sessionId, auth.accountId)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      return NextResponse.json({
        ok: true,
        release,
        review: reviews[0] ?? null,
      });
    }

    return NextResponse.json({ ok: false, error: 'unknown_action' }, { status: 400 });
  } catch (error) {
    const storeFailure = storeFailureResponse(error);
    if (storeFailure) return storeFailure;
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
