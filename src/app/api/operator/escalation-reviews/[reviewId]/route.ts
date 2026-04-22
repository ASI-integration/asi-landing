import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import {
  acknowledgeEscalationReview,
  approveEscalationReview,
  closeEscalationReview,
  getEscalationReview,
  sendOperatorReply,
} from '@/lib/communication/operator-review';

export const dynamic = 'force-dynamic';

async function requireSession() {
  const session = await getSession();
  if (!session.userId) return null;
  return session;
}

export async function GET(_req: NextRequest, ctx: { params: { reviewId: string } }) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const review = getEscalationReview(ctx.params.reviewId);
  if (!review) {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, review });
}

export async function PATCH(req: NextRequest, ctx: { params: { reviewId: string } }) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const action = String(body.action ?? '');
  const operatorId = session.userId;
  const reviewId = ctx.params.reviewId;

  try {
    if (action === 'acknowledge') {
      const review = acknowledgeEscalationReview(reviewId, operatorId);
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
      const result = await sendOperatorReply({ reviewId, operatorId, replyText });
      if (!result.ok) {
        return NextResponse.json({ ok: false, error: result.error ?? 'send_failed' }, { status: 400 });
      }
      return NextResponse.json({ ok: true, review: result.review, duplicatePrevented: result.duplicatePrevented ?? false });
    }

    return NextResponse.json({ ok: false, error: 'unknown_action' }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

