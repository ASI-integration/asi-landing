/**
 * Admin endpoint: resolve an escalation by returning the session to active.
 *
 * POST /api/admin/resolve-escalation
 * Header: x-admin-secret: {ADMIN_SECRET}
 *
 * Body (JSON):
 *   {
 *     chat_id: number   // REQUIRED — Telegram chat ID
 *   }
 *
 * Transitions session: operator_review_required → active
 *
 * Returns:
 *   200 { ok: true, chat_id, previous_status, new_status: "active" }
 *   400 { error: "..." }
 *   401 { error: "Unauthorized" }
 *   409 { ok: false, error: "invalid_transition", current_status }
 *   500 { ok: false, error: "..." }
 */

import { NextResponse } from 'next/server';
import { requireAdminSecret } from '@/lib/admin-auth';
import { getSessionStatus, transitionSessionStatus, SessionStatus } from '@/lib/communication/session-status';
import { appendTimelineEvent } from '@/lib/communication/timeline';

export async function POST(req: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const authFailure = requireAdminSecret(req);
  if (authFailure) return authFailure;

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { chat_id } = body;

  if (chat_id == null || isNaN(Number(chat_id))) {
    return NextResponse.json({ error: 'chat_id is required and must be a number' }, { status: 400 });
  }

  const chatIdNum = Number(chat_id);

  // ── Read current status ───────────────────────────────────────────────────
  const previousStatus = await getSessionStatus(chatIdNum);

  // ── Transition ────────────────────────────────────────────────────────────
  await transitionSessionStatus(chatIdNum, SessionStatus.Active);

  const newStatus = await getSessionStatus(chatIdNum);

  if (newStatus !== SessionStatus.Active) {
    return NextResponse.json(
      { ok: false, error: 'invalid_transition', current_status: previousStatus },
      { status: 409 },
    );
  }

  // ── Timeline ──────────────────────────────────────────────────────────────
  appendTimelineEvent(
    `tg_${chatIdNum}`,
    { type: 'escalation', reason: `resolved_by_operator previous=${previousStatus}`, ts: new Date() },
  ).catch(() => {});

  return NextResponse.json({ ok: true, chat_id: chatIdNum, previous_status: previousStatus, new_status: newStatus });
}
