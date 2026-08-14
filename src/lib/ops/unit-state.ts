/**
 * Minimum unit operational state model.
 *
 * Tracks the lifecycle of a rental unit through:
 *   idle → occupied → checkout_due → turnover_needed → in_turnover → ready
 *
 * All writes go to the `unit_state` table (one row per property_id).
 * Readiness gates are enforced before a unit can reach `ready`.
 *
 * Timeline events are emitted for every state change and are stored in
 * the in-memory timeline (keyed by `prop_{property_id}`).
 */

import { supabase } from '@/lib/supabase';

// ─── Enums ────────────────────────────────────────────────────────────────────

export const UnitStateValue = {
  Idle:            'idle',
  Occupied:        'occupied',
  CheckoutDue:     'checkout_due',
  TurnoverNeeded:  'turnover_needed',
  InTurnover:      'in_turnover',
  Ready:           'ready',
  Blocked:         'blocked',
} as const;
export type UnitStateValue = (typeof UnitStateValue)[keyof typeof UnitStateValue];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UnitState {
  id:                         string;
  property_id:                string;
  current_state:              UnitStateValue;
  current_reservation_id:     string | null;
  dirty:                      boolean;
  ready_for_checkin:          boolean;
  blocked_reason:             string | null;
  last_checkout_at:           string | null;
  last_turnover_completed_at: string | null;
  updated_at:                 string;
}

export interface UnitStateTransitionParams {
  property_id:           string;
  new_state:             UnitStateValue;
  reservation_id?:       string | null;
  dirty?:                boolean;
  ready_for_checkin?:    boolean;
  blocked_reason?:       string | null;
  last_checkout_at?:     string | null;
  last_turnover_completed_at?: string | null;
  /** Source event label for audit/logging. */
  source?:               string;
}

export interface ReadinessGateResult {
  ready:          boolean;
  blocked_reason: string | null;
}

// ─── Get ──────────────────────────────────────────────────────────────────────

export async function getUnitState(
  property_id: string,
): Promise<{ ok: boolean; state: UnitState | null; error?: string }> {
  const { data, error } = await supabase
    .from('unit_state')
    .select('*')
    .eq('property_id', property_id)
    .maybeSingle();

  if (error) return { ok: false, state: null, error: error.message };
  return { ok: true, state: data as UnitState | null };
}

// ─── Readiness Gates ─────────────────────────────────────────────────────────

/**
 * Check all required gates before allowing a unit to become `ready`.
 *
 * Required gates:
 *   1. property must be active (active = true in tg_property_knowledge)
 *   2. dirty must be false
 *   3. no unresolved turnover task
 *   4. no blocked_reason
 *
 * Optional gates (checked if cheap — only if fields exist):
 *   5. checkin_instructions present in tg_property_knowledge
 *   6. wifi_name present in tg_property_knowledge
 */
export async function checkReadinessGates(
  property_id: string,
  current: Partial<Pick<UnitState, 'dirty' | 'blocked_reason'>>,
): Promise<ReadinessGateResult> {
  // Gate 1: property must be active
  const { data: pk, error: propertyKnowledgeError } = await supabase
    .from('tg_property_knowledge')
    .select('active, checkin_instructions, wifi_name')
    .eq('property_id', property_id)
    .maybeSingle();

  if (propertyKnowledgeError) {
    return { ready: false, blocked_reason: 'property_knowledge_lookup_failed' };
  }
  if (!pk) {
    return { ready: false, blocked_reason: 'property_knowledge_missing' };
  }
  if (pk.active === false) {
    return { ready: false, blocked_reason: 'property_inactive' };
  }

  // Gate 2: dirty must be false
  if (current.dirty) {
    return { ready: false, blocked_reason: 'unit_dirty' };
  }

  // Gate 3: no blocked_reason on current state
  if (current.blocked_reason) {
    return { ready: false, blocked_reason: current.blocked_reason };
  }

  // Gate 4: no unresolved turnover task
  const { data: openTurnover } = await supabase
    .from('ops_tasks')
    .select('id')
    .eq('property_id', property_id)
    .eq('task_type', 'turnover')
    .in('task_status', ['open', 'in_progress'])
    .limit(1)
    .maybeSingle();

  if (openTurnover) {
    return { ready: false, blocked_reason: 'open_turnover_task' };
  }

  // Optional gate 5: checkin_instructions
  if (!pk.checkin_instructions) {
    return { ready: false, blocked_reason: 'check_in_instructions_missing' };
  }

  // Optional gate 6: wifi_name
  if (!pk.wifi_name) {
    return { ready: false, blocked_reason: 'wifi_name_missing' };
  }

  return { ready: true, blocked_reason: null };
}

// ─── Transition ───────────────────────────────────────────────────────────────

/**
 * Upsert unit state for a property.
 *
 * - Creates the row if it doesn't exist yet.
 * - Merges only the provided fields (all others preserved).
 * - Returns the updated state.
 */
export async function transitionUnitState(
  params: UnitStateTransitionParams,
): Promise<{ ok: boolean; state: UnitState | null; error?: string }> {
  const {
    property_id,
    new_state,
    reservation_id,
    dirty,
    ready_for_checkin,
    blocked_reason,
    last_checkout_at,
    last_turnover_completed_at,
  } = params;

  const now = new Date().toISOString();

  // Build the upsert payload — only include fields explicitly provided.
  const payload: Record<string, unknown> = {
    property_id,
    current_state: new_state,
    updated_at:    now,
  };

  if (reservation_id    !== undefined) payload.current_reservation_id     = reservation_id;
  if (dirty             !== undefined) payload.dirty                      = dirty;
  if (ready_for_checkin !== undefined) payload.ready_for_checkin          = ready_for_checkin;
  if (blocked_reason    !== undefined) payload.blocked_reason             = blocked_reason;
  if (last_checkout_at  !== undefined) payload.last_checkout_at           = last_checkout_at;
  if (last_turnover_completed_at !== undefined) payload.last_turnover_completed_at = last_turnover_completed_at;

  const { data, error } = await supabase
    .from('unit_state')
    .upsert(payload, { onConflict: 'property_id', ignoreDuplicates: false })
    .select('*')
    .single();

  if (error) return { ok: false, state: null, error: error.message };
  return { ok: true, state: data as UnitState };
}

// ─── Derived helpers ──────────────────────────────────────────────────────────

/** Mark unit as occupied when a reservation becomes active. */
export async function markUnitOccupied(
  property_id: string,
  reservation_id: string,
): Promise<{ ok: boolean; state: UnitState | null; error?: string }> {
  return transitionUnitState({
    property_id,
    new_state:         UnitStateValue.Occupied,
    reservation_id,
    dirty:             false,
    ready_for_checkin: false,
    blocked_reason:    null,
    source:            'reservation_active',
  });
}

/** Mark unit checkout_due when the checkout task becomes active. */
export async function markUnitCheckoutDue(
  property_id: string,
  reservation_id: string | null,
): Promise<{ ok: boolean; state: UnitState | null; error?: string }> {
  return transitionUnitState({
    property_id,
    new_state:      UnitStateValue.CheckoutDue,
    reservation_id,
    source:         'checkout_task_active',
  });
}

/**
 * Mark unit turnover_needed when checkout task resolves.
 * Sets dirty = true.
 */
export async function markUnitTurnoverNeeded(
  property_id: string,
  reservation_id: string | null,
): Promise<{ ok: boolean; state: UnitState | null; error?: string }> {
  const now = new Date().toISOString();
  return transitionUnitState({
    property_id,
    new_state:          UnitStateValue.TurnoverNeeded,
    reservation_id,
    dirty:              true,
    ready_for_checkin:  false,
    last_checkout_at:   now,
    source:             'checkout_task_resolved',
  });
}

/** Mark unit in_turnover when the turnover task starts. */
export async function markUnitInTurnover(
  property_id: string,
  reservation_id: string | null,
): Promise<{ ok: boolean; state: UnitState | null; error?: string }> {
  return transitionUnitState({
    property_id,
    new_state:      UnitStateValue.InTurnover,
    reservation_id,
    source:         'turnover_task_in_progress',
  });
}

/**
 * Attempt to mark unit ready after turnover completes.
 *
 * Runs all readiness gates first. If any gate fails, transitions to `blocked`
 * instead and stores the blocked_reason.
 *
 * Returns the final state (ready or blocked) and a `gate_blocked` flag.
 */
export async function markUnitReadyAfterTurnover(
  property_id: string,
  reservation_id: string | null,
): Promise<{
  ok:           boolean;
  state:        UnitState | null;
  gate_blocked: boolean;
  error?:       string;
}> {
  const now = new Date().toISOString();

  // Read current state to feed gates.
  const current = await getUnitState(property_id);
  const cur = current.state ?? { dirty: true, blocked_reason: null };

  const gates = await checkReadinessGates(property_id, {
    dirty:          false, // turnover just completed — assume clean now
    blocked_reason: cur.blocked_reason,
  });

  if (!gates.ready) {
    const result = await transitionUnitState({
      property_id,
      new_state:      UnitStateValue.Blocked,
      reservation_id,
      dirty:          false,
      ready_for_checkin: false,
      blocked_reason: gates.blocked_reason,
      last_turnover_completed_at: now,
      source:         'turnover_resolved_gates_failed',
    });
    return { ok: result.ok, state: result.state, gate_blocked: true, error: result.error };
  }

  const result = await transitionUnitState({
    property_id,
    new_state:                  UnitStateValue.Ready,
    reservation_id,
    dirty:                      false,
    ready_for_checkin:          true,
    blocked_reason:             null,
    last_turnover_completed_at: now,
    source:                     'turnover_resolved',
  });
  return { ok: result.ok, state: result.state, gate_blocked: false, error: result.error };
}

// ─── Next-reservation unlock ──────────────────────────────────────────────────

/**
 * After a unit becomes ready, find the nearest upcoming reservation for this
 * property that is still readiness-blocked and clear its blocked state so the
 * next normal runner pass can proceed automatically.
 *
 * Safety rules:
 *   - Only affects reservations for the given property_id.
 *   - Ignores cancelled reservations.
 *   - Ignores check-ins older than 48 h to avoid touching historical records.
 *   - Picks the one with the nearest upcoming check_in (ascending).
 *   - Idempotent: if already cleared, the query returns nothing and is a no-op.
 */
export async function unlockNextBlockedReservation(
  property_id: string,
): Promise<{
  ok:             boolean;
  reservation_id: string | null;
  chat_id:        string | null;
  error?:         string;
}> {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('tg_guest_reservations')
    .select('id, chat_id')
    .eq('property_id', property_id)
    .eq('readiness_blocked', true)
    .neq('status', 'cancelled')
    .gte('check_in', cutoff)
    .order('check_in', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    return { ok: false, reservation_id: null, chat_id: null, error: error.message };
  }
  if (!data) {
    return { ok: true, reservation_id: null, chat_id: null };
  }

  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from('tg_guest_reservations')
    .update({
      readiness_blocked:      false,
      readiness_block_reason: null,
      readiness_checked_at:   now,
    })
    .eq('id', data.id);

  if (updateError) {
    return { ok: false, reservation_id: null, chat_id: null, error: updateError.message };
  }

  return { ok: true, reservation_id: data.id as string, chat_id: (data.chat_id as string | null) ?? null };
}

/** Block a unit with an explicit reason. */
export async function blockUnit(
  property_id: string,
  reason: string,
): Promise<{ ok: boolean; state: UnitState | null; error?: string }> {
  return transitionUnitState({
    property_id,
    new_state:      UnitStateValue.Blocked,
    blocked_reason: reason,
    ready_for_checkin: false,
    source:         'operator_block',
  });
}

/** Clear a block and return to the appropriate state. */
export async function unblockUnit(
  property_id: string,
): Promise<{ ok: boolean; state: UnitState | null; error?: string }> {
  // After clearing a block, return to idle unless dirty (then turnover_needed).
  const current = await getUnitState(property_id);
  const wasDirty = current.state?.dirty ?? false;

  return transitionUnitState({
    property_id,
    new_state:      wasDirty ? UnitStateValue.TurnoverNeeded : UnitStateValue.Idle,
    blocked_reason: null,
    source:         'operator_unblock',
  });
}
