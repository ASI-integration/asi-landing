/**
 * Unit tests for src/lib/ops/checkin-gate.ts
 *
 * Covers:
 *  - Gate passes when unit state is ready + ready_for_checkin
 *  - Gate blocks when unit is dirty / turnover_needed / in_turnover / blocked
 *  - Gate blocks when no unit_state row exists
 *  - Gate blocks when DB lookup fails
 *  - Blocked reason is correct and specific for each state
 *  - Idempotent: repeated calls return consistent results
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Supabase mock ─────────────────────────────────────────────────────────────

type MockRow = Record<string, unknown>;

let mockUnitState: MockRow | null = null;
let mockSelectError: string | null = null;

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const stub = {
        select: (_cols?: string) => stub,
        eq:     (_col: string, _val: unknown) => stub,
        maybeSingle: async () => {
          if (table === 'unit_state') {
            if (mockSelectError) return { data: null, error: { message: mockSelectError } };
            return { data: mockUnitState, error: null };
          }
          return { data: null, error: null };
        },
      };
      return stub;
    },
  },
}));

import { evaluateCheckinReadiness } from '../checkin-gate';

beforeEach(() => {
  mockUnitState = null;
  mockSelectError = null;
});

// ─── Happy path ───────────────────────────────────────────────────────────────

describe('evaluateCheckinReadiness — allowed', () => {
  it('allows when unit is ready and ready_for_checkin = true', async () => {
    mockUnitState = {
      id: 'us-1',
      property_id: 'prop_A',
      current_state: 'ready',
      ready_for_checkin: true,
      dirty: false,
      blocked_reason: null,
    };

    const result = await evaluateCheckinReadiness('prop_A');
    expect(result.allowed).toBe(true);
    expect(result.unit_state).toBe('ready');
    expect(result.blocked_reason).toBeNull();
    expect(result.checked_at).toBeTruthy();
  });
});

// ─── Blocked scenarios ────────────────────────────────────────────────────────

describe('evaluateCheckinReadiness — blocked', () => {
  it('blocks when no unit_state row exists', async () => {
    mockUnitState = null;

    const result = await evaluateCheckinReadiness('prop_A');
    expect(result.allowed).toBe(false);
    expect(result.unit_state).toBeNull();
    expect(result.blocked_reason).toBe('unit_state_missing');
  });

  it('blocks when DB lookup fails', async () => {
    mockSelectError = 'connection timeout';

    const result = await evaluateCheckinReadiness('prop_A');
    expect(result.allowed).toBe(false);
    expect(result.blocked_reason).toBe('unit_state_lookup_error');
  });

  it('blocks when unit is dirty', async () => {
    mockUnitState = {
      id: 'us-1',
      property_id: 'prop_A',
      current_state: 'turnover_needed',
      ready_for_checkin: false,
      dirty: true,
      blocked_reason: null,
    };

    const result = await evaluateCheckinReadiness('prop_A');
    expect(result.allowed).toBe(false);
    expect(result.blocked_reason).toBe('unit_dirty');
  });

  it('blocks when state is turnover_needed (not dirty)', async () => {
    mockUnitState = {
      id: 'us-1',
      property_id: 'prop_A',
      current_state: 'turnover_needed',
      ready_for_checkin: false,
      dirty: false,
      blocked_reason: null,
    };

    const result = await evaluateCheckinReadiness('prop_A');
    expect(result.allowed).toBe(false);
    expect(result.blocked_reason).toBe('turnover_needed');
  });

  it('blocks when state is in_turnover', async () => {
    mockUnitState = {
      id: 'us-1',
      property_id: 'prop_A',
      current_state: 'in_turnover',
      ready_for_checkin: false,
      dirty: false,
      blocked_reason: null,
    };

    const result = await evaluateCheckinReadiness('prop_A');
    expect(result.allowed).toBe(false);
    expect(result.blocked_reason).toBe('turnover_in_progress');
  });

  it('blocks when state is blocked with specific reason', async () => {
    mockUnitState = {
      id: 'us-1',
      property_id: 'prop_A',
      current_state: 'blocked',
      ready_for_checkin: false,
      dirty: false,
      blocked_reason: 'property_inactive',
    };

    const result = await evaluateCheckinReadiness('prop_A');
    expect(result.allowed).toBe(false);
    expect(result.blocked_reason).toBe('property_inactive');
  });

  it('blocks when state is blocked without specific reason', async () => {
    mockUnitState = {
      id: 'us-1',
      property_id: 'prop_A',
      current_state: 'blocked',
      ready_for_checkin: false,
      dirty: false,
      blocked_reason: null,
    };

    const result = await evaluateCheckinReadiness('prop_A');
    expect(result.allowed).toBe(false);
    expect(result.blocked_reason).toBe('unit_blocked');
  });

  it('blocks when state is occupied', async () => {
    mockUnitState = {
      id: 'us-1',
      property_id: 'prop_A',
      current_state: 'occupied',
      ready_for_checkin: false,
      dirty: false,
      blocked_reason: null,
    };

    const result = await evaluateCheckinReadiness('prop_A');
    expect(result.allowed).toBe(false);
    expect(result.blocked_reason).toBe('unit_not_ready');
  });

  it('blocks when state is idle', async () => {
    mockUnitState = {
      id: 'us-1',
      property_id: 'prop_A',
      current_state: 'idle',
      ready_for_checkin: false,
      dirty: false,
      blocked_reason: null,
    };

    const result = await evaluateCheckinReadiness('prop_A');
    expect(result.allowed).toBe(false);
    expect(result.blocked_reason).toBe('unit_not_ready');
  });

  it('blocks when state is ready but ready_for_checkin is false', async () => {
    // Edge case: state says ready but flag is false (shouldn't normally happen)
    mockUnitState = {
      id: 'us-1',
      property_id: 'prop_A',
      current_state: 'ready',
      ready_for_checkin: false,
      dirty: false,
      blocked_reason: null,
    };

    const result = await evaluateCheckinReadiness('prop_A');
    expect(result.allowed).toBe(false);
    expect(result.blocked_reason).toBe('unit_not_ready');
  });
});

// ─── Idempotency ──────────────────────────────────────────────────────────────

describe('evaluateCheckinReadiness — idempotency', () => {
  it('returns consistent results on repeated calls', async () => {
    mockUnitState = {
      id: 'us-1',
      property_id: 'prop_A',
      current_state: 'turnover_needed',
      ready_for_checkin: false,
      dirty: true,
      blocked_reason: null,
    };

    const first  = await evaluateCheckinReadiness('prop_A');
    const second = await evaluateCheckinReadiness('prop_A');

    expect(first.allowed).toBe(second.allowed);
    expect(first.blocked_reason).toBe(second.blocked_reason);
    expect(first.unit_state).toBe(second.unit_state);
  });

  it('result changes when state changes from blocked to ready', async () => {
    // First call: blocked
    mockUnitState = {
      id: 'us-1',
      property_id: 'prop_A',
      current_state: 'in_turnover',
      ready_for_checkin: false,
      dirty: false,
      blocked_reason: null,
    };
    const blocked = await evaluateCheckinReadiness('prop_A');
    expect(blocked.allowed).toBe(false);

    // Unit becomes ready
    mockUnitState = {
      id: 'us-1',
      property_id: 'prop_A',
      current_state: 'ready',
      ready_for_checkin: true,
      dirty: false,
      blocked_reason: null,
    };
    const ready = await evaluateCheckinReadiness('prop_A');
    expect(ready.allowed).toBe(true);
  });
});
