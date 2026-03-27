/**
 * Admin endpoint: resolve an escalated conversation / stay-flow.
 *
 * POST /api/admin/resolve-escalation
 * Header: x-admin-secret: {ADMIN_SECRET}
 *
 * Body (JSON):
 *   {
 *     escalation_event_id?: string   // direct PK lookup (takes precedence)
 *     chat_id?:             number   // fallback: most recent unresolved escalation for chat
 *     action:               "resolve_and_resume" | "resolve_only" | "close_without_resume"
 *     operator_note?:       string   // optional free-text
 *     resolved_by?:         string   // operator identifier (e.g. email or name)
 *   }
 *
 * Actions:
 *   resolve_and_resume    — mark resolved + resume stay flow at safest next state
 *   resolve_only          — mark resolved, leave stay flow in escalated state
 *   close_without_resume  — mark resolved + close stay flow permanently
 *
 * Idempotent: repeating the same call on an already-resolved event returns
 * { ok: true, alreadyResolved: true } with no duplicate side effects.
 *
 * Returns:
 *   200 { ok: true, escalationEventId, resumedStatus?, alreadyResolved? }
 *   400 { error: "..." }   — missing or invalid fields
 *   401 { error: "Unauthorized" }
 *   500 { ok: false, error: "..." }
 */

import { NextResponse } from 'next/server';
import {
  resolveEscalation,
  VALID_RESOLUTION_ACTIONS,
  type ResolutionAction,
} from '@/lib/communication/escalation-resolution';

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

  const {
    escalation_event_id,
    chat_id,
    action,
    operator_note,
    resolved_by,
  } = body;

  // ── Validate ──────────────────────────────────────────────────────────────
  if (!escalation_event_id && chat_id == null) {
    return NextResponse.json(
      { error: 'Provide escalation_event_id or chat_id' },
      { status: 400 },
    );
  }

  if (!action || !VALID_RESOLUTION_ACTIONS.includes(action as ResolutionAction)) {
    return NextResponse.json(
      { error: `action must be one of: ${VALID_RESOLUTION_ACTIONS.join(', ')}` },
      { status: 400 },
    );
  }

  // ── Resolve ───────────────────────────────────────────────────────────────
  const result = await resolveEscalation({
    escalationEventId: escalation_event_id != null ? String(escalation_event_id) : undefined,
    chatId:            chat_id             != null ? Number(chat_id)              : undefined,
    action:            action as ResolutionAction,
    operatorNote:      operator_note       != null ? String(operator_note)        : undefined,
    resolvedBy:        resolved_by         != null ? String(resolved_by)          : undefined,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 500 });
  }

  return NextResponse.json(result);
}
