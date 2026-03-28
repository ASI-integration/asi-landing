/**
 * Admin endpoint: safe operator updates to unit state.
 *
 * POST /api/admin/update-unit-state
 * Header: x-admin-secret: {ADMIN_SECRET}
 *
 * Body (JSON) — one or more actions:
 *   {
 *     property_id:      string   // REQUIRED
 *     action:           "block" | "unblock" | "mark_dirty" | "mark_ready_override"
 *     blocked_reason?:  string   // required when action = "block"
 *   }
 *
 * Actions:
 *   block              — set blocked_reason, transition to blocked
 *   unblock            — clear blocked_reason, return to idle or turnover_needed
 *   mark_dirty         — set dirty = true (operator override)
 *   mark_ready_override — force ready state (operator override, clearly flagged in response)
 *
 * Returns:
 *   200 { ok: true, state: UnitState, action, override?: true }
 *   400 { error: "..." }
 *   401 { error: "Unauthorized" }
 *   500 { ok: false, error: "..." }
 */

import { NextResponse } from 'next/server';
import {
  blockUnit,
  unblockUnit,
  getUnitState,
  transitionUnitState,
  UnitStateValue,
} from '@/lib/ops/unit-state';
import { appendTimelineEvent } from '@/lib/communication/timeline';

const VALID_ACTIONS = new Set(['block', 'unblock', 'mark_dirty', 'mark_ready_override', 'bootstrap']);

export async function POST(req: Request) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const adminSecret = process.env.ADMIN_SECRET;
  const secret = req.headers.get('x-admin-secret');
  if (adminSecret && secret !== adminSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { property_id, action, blocked_reason } = body;

  // ── Validate ──────────────────────────────────────────────────────────────
  if (!property_id || typeof property_id !== 'string' || !property_id.trim()) {
    return NextResponse.json({ error: 'property_id is required' }, { status: 400 });
  }
  if (!action || typeof action !== 'string' || !VALID_ACTIONS.has(action)) {
    return NextResponse.json(
      { error: `action must be one of: ${[...VALID_ACTIONS].join(', ')}` },
      { status: 400 },
    );
  }
  if (action === 'block' && (!blocked_reason || typeof blocked_reason !== 'string')) {
    return NextResponse.json({ error: 'blocked_reason is required when action is "block"' }, { status: 400 });
  }

  // ── Execute action ─────────────────────────────────────────────────────────
  let stateResult: Awaited<ReturnType<typeof transitionUnitState>>;
  let isOverride = false;

  // bootstrap: create idle row if missing; no-op (return existing) if present.
  if (action === 'bootstrap') {
    const existing = await getUnitState(property_id);
    if (!existing.ok) {
      return NextResponse.json({ ok: false, error: existing.error }, { status: 500 });
    }
    if (existing.state) {
      return NextResponse.json({ ok: true, action, state: existing.state, bootstrapped: false });
    }
    stateResult = await transitionUnitState({
      property_id,
      new_state:         UnitStateValue.Idle,
      dirty:             false,
      ready_for_checkin: false,
      blocked_reason:    null,
      source:            'operator_bootstrap',
    });
    if (!stateResult.ok) {
      return NextResponse.json({ ok: false, error: stateResult.error }, { status: 500 });
    }
    return NextResponse.json({ ok: true, action, state: stateResult.state, bootstrapped: true });
  }

  if (action === 'block') {
    stateResult = await blockUnit(property_id, blocked_reason as string);
    if (stateResult.ok && stateResult.state) {
      appendTimelineEvent(`prop_${property_id}`, {
        type: 'unit_blocked',
        property_id,
        blocked_reason: blocked_reason as string,
        ts: new Date(),
      }).catch(() => {});
    }
  } else if (action === 'unblock') {
    stateResult = await unblockUnit(property_id);
    if (stateResult.ok && stateResult.state) {
      appendTimelineEvent(`prop_${property_id}`, {
        type: 'unit_state_changed',
        property_id,
        from_state: 'blocked',
        to_state: stateResult.state.current_state,
        ts: new Date(),
      }).catch(() => {});
    }
  } else if (action === 'mark_dirty') {
    stateResult = await transitionUnitState({
      property_id,
      new_state: UnitStateValue.TurnoverNeeded,
      dirty:     true,
      ready_for_checkin: false,
      source:    'operator_mark_dirty',
    });
  } else {
    // mark_ready_override — operator forces ready state
    isOverride = true;
    stateResult = await transitionUnitState({
      property_id,
      new_state:         UnitStateValue.Ready,
      dirty:             false,
      ready_for_checkin: true,
      blocked_reason:    null,
      source:            'operator_ready_override',
    });
    if (stateResult.ok && stateResult.state) {
      appendTimelineEvent(`prop_${property_id}`, {
        type: 'unit_ready',
        property_id,
        reservation_id: null,
        ts: new Date(),
      }).catch(() => {});
    }
  }

  if (!stateResult.ok) {
    return NextResponse.json({ ok: false, error: stateResult.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    action,
    state: stateResult.state,
    ...(isOverride ? { override: true } : {}),
  });
}
