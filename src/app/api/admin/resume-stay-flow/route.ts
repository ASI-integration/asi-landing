/**
 * Admin endpoint: resume an escalated stay flow independent of escalation
 * resolution state.
 *
 * Use this when an operator has already called resolve_only (or
 * resolve_and_resume failed to find the flow) and now wants to unblock
 * the stay flow without creating a new escalation.
 *
 * POST /api/admin/resume-stay-flow
 * Header: x-admin-secret: {ADMIN_SECRET}
 *
 * Body (JSON):
 *   {
 *     chat_id:      number   // required — identifies the stay flow
 *     resumed_by?:  string   // optional operator identifier
 *   }
 *
 * Behavior:
 *   - Flow in escalated state → advance to safest date-derived next state,
 *     write timeline event, return { ok: true, resumedStatus }
 *   - Flow NOT in escalated state (already active/closed) →
 *     return { ok: true, alreadyResumed: true, currentStatus } — no change
 *   - No flow found → 404
 *
 * Idempotent: safe to call multiple times. No duplicate message sends.
 *
 * Returns:
 *   200 { ok: true, resumedStatus }            — flow advanced
 *   200 { ok: true, alreadyResumed: true, currentStatus } — no-op
 *   400 { error: "..." }                       — missing fields
 *   401 { error: "Unauthorized" }
 *   404 { ok: false, error: "..." }            — no flow for chat_id
 *   500 { ok: false, error: "..." }
 */

import { NextResponse } from 'next/server';
import { resumeStayFlow } from '@/lib/communication/escalation-resolution';

const ADMIN_SECRET = process.env.ADMIN_SECRET;

export async function POST(req: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const secret = req.headers.get('x-admin-secret');
  if (ADMIN_SECRET && secret !== ADMIN_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { chat_id, resumed_by } = body;

  if (chat_id == null) {
    return NextResponse.json({ error: 'chat_id is required' }, { status: 400 });
  }

  // ── Resume ────────────────────────────────────────────────────────────────
  const result = await resumeStayFlow({
    chatId:     Number(chat_id),
    resumedBy:  resumed_by != null ? String(resumed_by) : undefined,
  });

  if (!result.ok) {
    // error = "No stay flow found" → 404
    return NextResponse.json(result, { status: 404 });
  }

  return NextResponse.json(result);
}
