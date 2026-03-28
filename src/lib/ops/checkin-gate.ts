/**
 * Check-in readiness gate.
 *
 * Evaluates whether a property's unit is ready for the next guest check-in.
 * Used by the communication orchestrator to decide whether it is safe to send
 * check-in instructions (door codes, wifi, etc.) or if a holding message
 * should be sent instead.
 *
 * Reusable: both the reactive orchestrator path and any future proactive
 * pre-checkin sender can call `evaluateCheckinReadiness`.
 */

import { getUnitState, UnitStateValue } from './unit-state';
import type { UnitState } from './unit-state';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CheckinGateResult {
  /** Whether check-in instructions may be sent. */
  allowed:        boolean;
  /** Current unit state value (null when no unit_state row exists). */
  unit_state:     UnitStateValue | null;
  /** Human-readable reason for blocking (null when allowed). */
  blocked_reason: string | null;
  /** ISO timestamp of evaluation. */
  checked_at:     string;
}

// ─── Blocked reason derivation ────────────────────────────────────────────────

/**
 * Map a unit state row to a concrete blocked reason.
 *
 * Uses the smallest consistent vocabulary grounded in the existing
 * `checkReadinessGates` output and unit state values.
 */
function deriveBlockedReason(state: UnitState): string | null {
  // Explicitly blocked with a stored reason
  if (state.current_state === UnitStateValue.Blocked) {
    return state.blocked_reason ?? 'unit_blocked';
  }

  // Dirty flag
  if (state.dirty) {
    return 'unit_dirty';
  }

  // States that clearly mean "not ready"
  const NOT_READY_STATES: Set<string> = new Set([
    UnitStateValue.Idle,
    UnitStateValue.Occupied,
    UnitStateValue.CheckoutDue,
    UnitStateValue.TurnoverNeeded,
    UnitStateValue.InTurnover,
  ]);

  if (NOT_READY_STATES.has(state.current_state)) {
    // Provide a more specific reason when possible
    if (state.current_state === UnitStateValue.TurnoverNeeded) return 'turnover_needed';
    if (state.current_state === UnitStateValue.InTurnover)     return 'turnover_in_progress';
    return 'unit_not_ready';
  }

  return null;
}

// ─── Gate evaluation ──────────────────────────────────────────────────────────

/**
 * Evaluate whether a property's unit is ready for guest check-in messaging.
 *
 * Rules:
 *   - No unit_state row → blocked (`unit_state_missing`)
 *   - `ready_for_checkin === true` AND `current_state === 'ready'` → allowed
 *   - Anything else → blocked with a reason derived from current state
 */
export async function evaluateCheckinReadiness(
  property_id: string,
): Promise<CheckinGateResult> {
  const now = new Date().toISOString();

  const { ok, state, error } = await getUnitState(property_id);

  // DB error → block conservatively
  if (!ok || error) {
    return {
      allowed:        false,
      unit_state:     null,
      blocked_reason: 'unit_state_lookup_error',
      checked_at:     now,
    };
  }

  // No row → block (unit has never been tracked)
  if (!state) {
    return {
      allowed:        false,
      unit_state:     null,
      blocked_reason: 'unit_state_missing',
      checked_at:     now,
    };
  }

  // Happy path: unit is ready
  if (state.current_state === UnitStateValue.Ready && state.ready_for_checkin) {
    return {
      allowed:        true,
      unit_state:     state.current_state,
      blocked_reason: null,
      checked_at:     now,
    };
  }

  // Not ready — derive a specific blocked reason
  const reason = deriveBlockedReason(state) ?? 'unit_not_ready';

  return {
    allowed:        false,
    unit_state:     state.current_state,
    blocked_reason: reason,
    checked_at:     now,
  };
}
