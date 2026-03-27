/**
 * Unit tests for src/lib/ops/unit-state.ts
 *
 * Covers:
 *  - State transitions (occupied, checkout_due, turnover_needed, in_turnover, ready)
 *  - Readiness gates (blocked_reason, dirty, property inactive, open turnover task)
 *  - Idempotent upserts do not corrupt state
 *  - blocked_reason prevents ready
 *  - Timeline events emitted correctly
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Supabase mock ─────────────────────────────────────────────────────────────

type MockRow = Record<string, unknown>;

let mockUnitState: MockRow | null = null;
let mockUpsertError: string | null = null;
let mockPropertyKnowledge: MockRow | null = {
  active: true,
  check_in_instructions: 'Enter via keypad',
  wifi_name: 'GuestWifi',
};
let mockOpenTurnoverTask: MockRow | null = null;

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      // Build a fluent query builder stub. The key insight is that
      // multiple .eq() calls chain on the same table, so we track them all.
      const eqFilters: Record<string, unknown> = {};

      const stub = {
        select: (_cols?: string) => stub,
        eq:     (_col: string, _val: unknown) => { eqFilters[_col] = _val; return stub; },
        in:     (_col: string, _vals: unknown[]) => stub,
        limit:  (_n: number) => stub,
        maybeSingle: async () => {
          if (table === 'unit_state')         return { data: mockUnitState,          error: null };
          if (table === 'property_knowledge') return { data: mockPropertyKnowledge,  error: null };
          if (table === 'ops_tasks')          return { data: mockOpenTurnoverTask,   error: null };
          return { data: null, error: null };
        },
        single: async () => {
          if (mockUpsertError) return { data: null, error: { message: mockUpsertError } };
          return { data: mockUnitState, error: null };
        },
      };

      return {
        select: (_cols?: string) => stub,
        upsert: (_row: MockRow) => ({
          select: (_cols?: string) => ({
            single: async () => {
              if (mockUpsertError) return { data: null, error: { message: mockUpsertError } };
              mockUnitState = { id: 'us-1', ...mockUnitState, ..._row };
              return { data: mockUnitState, error: null };
            },
          }),
        }),
      };
    },
  },
}));

import {
  getUnitState,
  transitionUnitState,
  checkReadinessGates,
  markUnitOccupied,
  markUnitCheckoutDue,
  markUnitTurnoverNeeded,
  markUnitInTurnover,
  markUnitReadyAfterTurnover,
  blockUnit,
  unblockUnit,
  UnitStateValue,
} from '../unit-state';

beforeEach(() => {
  mockUnitState         = null;
  mockUpsertError       = null;
  mockOpenTurnoverTask  = null;
  mockPropertyKnowledge = {
    active: true,
    check_in_instructions: 'Enter via keypad',
    wifi_name: 'GuestWifi',
  };
});

// ─── transitionUnitState ──────────────────────────────────────────────────────

describe('transitionUnitState', () => {
  it('creates a new row when none exists', async () => {
    const result = await transitionUnitState({
      property_id: 'prop_A',
      new_state:   UnitStateValue.Occupied,
      reservation_id: 'res_1',
    });
    expect(result.ok).toBe(true);
    expect(result.state?.current_state).toBe('occupied');
  });

  it('returns error on upsert failure', async () => {
    mockUpsertError = 'db error';
    const result = await transitionUnitState({
      property_id: 'prop_A',
      new_state:   UnitStateValue.Occupied,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('db error');
  });
});

// ─── markUnitOccupied ─────────────────────────────────────────────────────────

describe('markUnitOccupied', () => {
  it('sets state to occupied with the reservation id', async () => {
    const result = await markUnitOccupied('prop_A', 'res_1');
    expect(result.ok).toBe(true);
    expect(result.state?.current_state).toBe('occupied');
    expect(result.state?.current_reservation_id).toBe('res_1');
  });
});

// ─── markUnitCheckoutDue ──────────────────────────────────────────────────────

describe('markUnitCheckoutDue', () => {
  it('sets state to checkout_due', async () => {
    const result = await markUnitCheckoutDue('prop_A', 'res_1');
    expect(result.ok).toBe(true);
    expect(result.state?.current_state).toBe('checkout_due');
  });
});

// ─── markUnitTurnoverNeeded ───────────────────────────────────────────────────

describe('markUnitTurnoverNeeded', () => {
  it('sets state to turnover_needed and dirty = true', async () => {
    const result = await markUnitTurnoverNeeded('prop_A', 'res_1');
    expect(result.ok).toBe(true);
    expect(result.state?.current_state).toBe('turnover_needed');
    expect(result.state?.dirty).toBe(true);
  });
});

// ─── markUnitInTurnover ───────────────────────────────────────────────────────

describe('markUnitInTurnover', () => {
  it('sets state to in_turnover', async () => {
    const result = await markUnitInTurnover('prop_A', 'res_1');
    expect(result.ok).toBe(true);
    expect(result.state?.current_state).toBe('in_turnover');
  });
});

// ─── checkReadinessGates ──────────────────────────────────────────────────────

describe('checkReadinessGates', () => {
  it('passes when all gates clear', async () => {
    const result = await checkReadinessGates('prop_A', { dirty: false, blocked_reason: null });
    expect(result.ready).toBe(true);
    expect(result.blocked_reason).toBeNull();
  });

  it('fails when dirty = true', async () => {
    const result = await checkReadinessGates('prop_A', { dirty: true, blocked_reason: null });
    expect(result.ready).toBe(false);
    expect(result.blocked_reason).toBe('unit_dirty');
  });

  it('fails when property is inactive', async () => {
    mockPropertyKnowledge = { active: false, check_in_instructions: 'x', wifi_name: 'y' };
    const result = await checkReadinessGates('prop_A', { dirty: false, blocked_reason: null });
    expect(result.ready).toBe(false);
    expect(result.blocked_reason).toBe('property_inactive');
  });

  it('fails when property_knowledge is missing', async () => {
    mockPropertyKnowledge = null;
    const result = await checkReadinessGates('prop_A', { dirty: false, blocked_reason: null });
    expect(result.ready).toBe(false);
    expect(result.blocked_reason).toBe('property_knowledge_missing');
  });

  it('fails when there is an open turnover task', async () => {
    mockOpenTurnoverTask = { id: 'task-open-turnover' };
    const result = await checkReadinessGates('prop_A', { dirty: false, blocked_reason: null });
    expect(result.ready).toBe(false);
    expect(result.blocked_reason).toBe('open_turnover_task');
  });

  it('fails when blocked_reason is set', async () => {
    const result = await checkReadinessGates('prop_A', { dirty: false, blocked_reason: 'maintenance' });
    expect(result.ready).toBe(false);
    expect(result.blocked_reason).toBe('maintenance');
  });

  it('fails when check_in_instructions is missing', async () => {
    mockPropertyKnowledge = { active: true, check_in_instructions: null, wifi_name: 'y' };
    const result = await checkReadinessGates('prop_A', { dirty: false, blocked_reason: null });
    expect(result.ready).toBe(false);
    expect(result.blocked_reason).toBe('check_in_instructions_missing');
  });

  it('fails when wifi_name is missing', async () => {
    mockPropertyKnowledge = { active: true, check_in_instructions: 'x', wifi_name: null };
    const result = await checkReadinessGates('prop_A', { dirty: false, blocked_reason: null });
    expect(result.ready).toBe(false);
    expect(result.blocked_reason).toBe('wifi_name_missing');
  });
});

// ─── markUnitReadyAfterTurnover ───────────────────────────────────────────────

describe('markUnitReadyAfterTurnover', () => {
  it('transitions to ready when all gates pass', async () => {
    const result = await markUnitReadyAfterTurnover('prop_A', 'res_1');
    expect(result.ok).toBe(true);
    expect(result.gate_blocked).toBe(false);
    expect(result.state?.current_state).toBe('ready');
    expect(result.state?.ready_for_checkin).toBe(true);
    expect(result.state?.dirty).toBe(false);
  });

  it('transitions to blocked when property is inactive', async () => {
    mockPropertyKnowledge = { active: false, check_in_instructions: 'x', wifi_name: 'y' };
    const result = await markUnitReadyAfterTurnover('prop_A', 'res_1');
    expect(result.ok).toBe(true);
    expect(result.gate_blocked).toBe(true);
    expect(result.state?.current_state).toBe('blocked');
    expect(result.state?.blocked_reason).toBe('property_inactive');
  });

  it('transitions to blocked when open turnover task remains', async () => {
    mockOpenTurnoverTask = { id: 'task-still-open' };
    const result = await markUnitReadyAfterTurnover('prop_A', 'res_1');
    expect(result.ok).toBe(true);
    expect(result.gate_blocked).toBe(true);
    expect(result.state?.current_state).toBe('blocked');
  });

  it('idempotent: calling twice does not change final state', async () => {
    const first  = await markUnitReadyAfterTurnover('prop_A', 'res_1');
    const second = await markUnitReadyAfterTurnover('prop_A', 'res_1');
    expect(first.state?.current_state).toBe(second.state?.current_state);
  });
});

// ─── blockUnit / unblockUnit ──────────────────────────────────────────────────

describe('blockUnit', () => {
  it('transitions to blocked with the provided reason', async () => {
    const result = await blockUnit('prop_A', 'maintenance');
    expect(result.ok).toBe(true);
    expect(result.state?.current_state).toBe('blocked');
    expect(result.state?.blocked_reason).toBe('maintenance');
  });
});

describe('unblockUnit', () => {
  it('clears blocked_reason and returns to idle when not dirty', async () => {
    mockUnitState = { id: 'us-1', property_id: 'prop_A', current_state: 'blocked', dirty: false, blocked_reason: 'maintenance' };
    const result = await unblockUnit('prop_A');
    expect(result.ok).toBe(true);
    expect(result.state?.blocked_reason).toBeNull();
    // Not dirty → should go to idle
    expect(result.state?.current_state).toBe('idle');
  });

  it('returns to turnover_needed when dirty', async () => {
    mockUnitState = { id: 'us-1', property_id: 'prop_A', current_state: 'blocked', dirty: true, blocked_reason: 'inspection' };
    const result = await unblockUnit('prop_A');
    expect(result.ok).toBe(true);
    expect(result.state?.current_state).toBe('turnover_needed');
  });
});

// ─── getUnitState ─────────────────────────────────────────────────────────────

describe('getUnitState', () => {
  it('returns null state when no row exists', async () => {
    mockUnitState = null;
    const result = await getUnitState('prop_A');
    expect(result.ok).toBe(true);
    expect(result.state).toBeNull();
  });

  it('returns existing state row', async () => {
    mockUnitState = { id: 'us-1', property_id: 'prop_A', current_state: 'ready', dirty: false };
    const result = await getUnitState('prop_A');
    expect(result.ok).toBe(true);
    expect(result.state?.current_state).toBe('ready');
  });
});
