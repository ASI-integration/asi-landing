import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getEscalationReview } from '@/lib/communication/operator-review';
import {
  correctGuestOperationalEvent,
  deleteGuestMemoryItem,
  forgetGuestLongTermMemory,
  loadGuestLongTermMemory,
  upsertGuestPreference,
  type GuestPreferenceKey,
} from '@/lib/communication/guest-long-term-memory';

export const dynamic = 'force-dynamic';

async function authorizedReview(reviewId: string) {
  const session = await getSession();
  if (!session.userId) return { ok: false as const, error: 'unauthorized' as const };
  const review = getEscalationReview(reviewId);
  if (!review) return { ok: false as const, error: 'not_found' as const };
  const guestId = String(review.source?.guest_id ?? '').trim();
  if (!guestId) return { ok: false as const, error: 'guest_memory_unavailable' as const };
  return { ok: true as const, session, review, guestId };
}

function errorResponse(error: string) {
  if (error === 'unauthorized') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (error === 'not_found') return NextResponse.json({ error }, { status: 404 });
  return NextResponse.json({ ok: true, memory: null, unavailable: true });
}

export async function GET(_req: NextRequest, ctx: { params: { reviewId: string } }) {
  const authorized = await authorizedReview(ctx.params.reviewId);
  if (!authorized.ok) return errorResponse(authorized.error);
  try {
    const memory = await loadGuestLongTermMemory(authorized.guestId);
    return NextResponse.json({ ok: true, memory });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'guest_memory_load_failed',
    }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: { reviewId: string } }) {
  const authorized = await authorizedReview(ctx.params.reviewId);
  if (!authorized.ok) return errorResponse(authorized.error);

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const action = String(body.action ?? '');
  try {
    if (action === 'correct_preference') {
      await upsertGuestPreference({
        guestId: authorized.guestId,
        key: String(body.key ?? '') as GuestPreferenceKey,
        value: String(body.value ?? ''),
        source: 'operator_confirmed',
        sourceRef: `operator:${authorized.session.userId}:review:${authorized.review.reviewId}`,
        confidence: 1,
      });
    } else if (action === 'delete_preference' || action === 'delete_event') {
      await deleteGuestMemoryItem({
        guestId: authorized.guestId,
        kind: action === 'delete_preference' ? 'preference' : 'event',
        itemId: String(body.itemId ?? ''),
      });
    } else if (action === 'correct_event') {
      await correctGuestOperationalEvent({
        guestId: authorized.guestId,
        itemId: String(body.itemId ?? ''),
        summary: String(body.summary ?? ''),
        sourceRef: `operator:${authorized.session.userId}:review:${authorized.review.reviewId}`,
      });
    } else if (action === 'forget_all') {
      await forgetGuestLongTermMemory(authorized.guestId);
    } else {
      return NextResponse.json({ ok: false, error: 'unknown_action' }, { status: 400 });
    }

    const memory = action === 'forget_all'
      ? { profile: null, preferences: [], events: [] }
      : await loadGuestLongTermMemory(authorized.guestId);
    return NextResponse.json({ ok: true, memory });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : 'guest_memory_update_failed',
    }, { status: 400 });
  }
}
