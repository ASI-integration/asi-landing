import { NextResponse } from 'next/server';

import {
  buildTelegramOpsAcceptanceMessage,
  cleanupTelegramOpsAcceptanceData,
  findAcceptanceEscalationReview,
  runTelegramOpsAcceptanceFull,
  runTelegramOpsAcceptanceLifecycle,
  verifyTelegramOpsTaskForReview,
} from '@/lib/communication/telegram-ops-acceptance';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isAuthorized(req: Request): boolean {
  const expected = process.env.INTERNAL_TEST_SECRET;
  if (!expected) return false;
  return req.headers.get('x-internal-test-secret') === expected;
}

function parseTargetId(body: Record<string, unknown>): string {
  const raw = String(body.chatId ?? body.targetId ?? body.test_chat_id ?? '').trim();
  if (!raw) throw new Error('chatId_required');
  return raw;
}

function parseMarker(body: Record<string, unknown>): string {
  const marker = String(body.marker ?? body.runId ?? '').trim();
  if (!marker) throw new Error('marker_required');
  return marker.includes('ASI_TG_OPS_ACCEPTANCE_')
    ? marker
    : buildTelegramOpsAcceptanceMessage(marker).split(' ')[0] ?? marker;
}

export async function POST(req: Request): Promise<Response> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const action = String(body.action ?? 'poll_review').trim();

  try {
    if (action === 'run') {
      const runId = String(body.runId ?? body.marker ?? '').trim() || undefined;
      const result = await runTelegramOpsAcceptanceFull({ runId });
      return NextResponse.json(result, { status: result.ok ? 200 : 422 });
    }

    if (action === 'poll_review') {
      const targetId = parseTargetId(body);
      const marker = parseMarker(body);
      const review = findAcceptanceEscalationReview({ targetId, marker });
      return NextResponse.json({
        ok: true,
        found: Boolean(review),
        review: review
          ? {
              reviewId: review.reviewId,
              sessionId: review.sessionId,
              status: review.status,
              escalationReason: review.escalationReason,
              createdAt: review.createdAt,
            }
          : null,
      });
    }

    if (action === 'verify_ops') {
      const reviewId = String(body.reviewId ?? '').trim();
      if (!reviewId) {
        return NextResponse.json({ ok: false, error: 'reviewId_required' }, { status: 400 });
      }

      const result = await verifyTelegramOpsTaskForReview(reviewId);
      return NextResponse.json({
        ok: result.ok,
        failures: result.failures,
        taskId: result.taskId,
        firstSync: result.firstSync,
        secondSync: result.secondSync,
      }, { status: result.ok ? 200 : 422 });
    }

    if (action === 'lifecycle') {
      const taskId = String(body.taskId ?? '').trim();
      if (!taskId) {
        return NextResponse.json({ ok: false, error: 'taskId_required' }, { status: 400 });
      }

      const result = await runTelegramOpsAcceptanceLifecycle(taskId);
      return NextResponse.json({
        ok: result.ok,
        failures: result.failures,
      }, { status: result.ok ? 200 : 422 });
    }

    if (action === 'cleanup') {
      await cleanupTelegramOpsAcceptanceData({
        reviewId: String(body.reviewId ?? '').trim() || null,
        taskId: String(body.taskId ?? '').trim() || null,
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: 'unknown_action' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'acceptance_failed';
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
