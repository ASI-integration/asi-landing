/**
 * Intelligence tests — updated for G2/G3 Supabase-backed reservation and
 * property knowledge lookups.
 *
 * The old hardcoded mock data (res_111, prop_A PROPERTY_DB) is replaced by
 * Supabase queries.  These tests seed selectRows to simulate DB records.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { matchReservation } from '../reservation';
import { getGroundedKnowledge } from '../knowledge';
import { buildCommunicationContext } from '../context';
import { classifyIssuePriority } from '../triage';
import { evaluateActionSafety } from '../action';
import { IntentCategory } from '../types';

// ─── Supabase mock ────────────────────────────────────────────────────────────

const selectRows: Record<string, unknown[]> = {};

function makeTableProxy(table: string) {
  const rows = () => selectRows[table] ?? [];

  const buildQuery = (filters: Array<{ col: string; val: unknown; op?: string }>) => {
    const applyFilters = () =>
      rows().filter(r => {
        const row = r as Record<string, unknown>;
        return filters.every(f => {
          if (f.op === 'ilike')
            return String(row[f.col]).toLowerCase() === String(f.val).toLowerCase();
          return row[f.col] == f.val;
        });
      });

    const q: Record<string, unknown> = {};
    q.select     = () => buildQuery(filters);
    q.eq         = (col: string, val: unknown) => buildQuery([...filters, { col, val }]);
    q.ilike      = (col: string, val: unknown) => buildQuery([...filters, { col, val, op: 'ilike' }]);
    q.order      = () => buildQuery(filters);
    q.limit      = () => buildQuery(filters);
    q.maybeSingle = async () => {
      const found = applyFilters();
      return { data: found[0] ?? null, error: null };
    };
    q.single = async () => {
      const found = applyFilters();
      return found[0] ? { data: found[0], error: null } : { data: null, error: { message: 'not found' } };
    };
    q.then = (cb: (v: unknown) => unknown) => cb({ data: applyFilters(), error: null });
    return q;
  };

  return {
    upsert:  async () => ({ error: null }),
    insert:  async () => ({ error: null }),
    select:  (_cols?: string) => buildQuery([]),
  };
}

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (table: string) => makeTableProxy(table) },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function seedReservations(rows: unknown[]) {
  selectRows['tg_guest_reservations'] = rows;
  // Also clear session so reservation lookup doesn't short-circuit on session data
  selectRows['tg_conversation_sessions'] = [];
}

function seedProperty(row: unknown) {
  selectRows['tg_property_knowledge'] = [row];
}

function resetAll() {
  for (const key of Object.keys(selectRows)) delete selectRows[key];
}

// ─── ReservationMatcher ───────────────────────────────────────────────────────

describe('ReservationMatcher (G2 — Supabase-backed)', () => {
  beforeEach(resetAll);

  it('matches exactly by booking reference', async () => {
    seedReservations([{
      id: 'res-111-uuid',
      reservation_ref: 'res_111',
      guest_name: 'John Doe',
      property_id: 'prop_A',
      phone: '+1234567890',
    }]);

    const res = await matchReservation({ bookingReference: 'res_111' });
    expect(res.status).toBe('matched');
    expect(res.guestName).toBe('John Doe');
  });

  it('matches exactly by phone', async () => {
    seedReservations([{
      id: 'res-111-uuid',
      phone: '+1234567890',
      guest_name: 'John Doe',
      property_id: 'prop_A',
    }]);

    const res = await matchReservation({ phone: '+1234567890' });
    expect(res.status).toBe('matched');
  });

  it('detects ambiguous names', async () => {
    seedReservations([
      { id: 'res-222', guest_name: 'Jane Smith', property_id: 'prop_B' },
      { id: 'res-333', guest_name: 'Jane Smith', property_id: 'prop_C' },
    ]);

    const res = await matchReservation({ guestName: 'Jane Smith' });
    expect(res.status).toBe('ambiguous');
    expect(res.candidates?.length).toBe(2);
  });

  it('returns unmatched securely when no data exists', async () => {
    const res = await matchReservation({ guestName: 'Nobody' });
    expect(res.status).toBe('unmatched');
  });
});

// ─── KnowledgeGrounder ────────────────────────────────────────────────────────

describe('KnowledgeGrounder (G3 — Supabase-backed)', () => {
  beforeEach(resetAll);

  it('returns explicit unavailability if knowledge missing', async () => {
    const know = await getGroundedKnowledge('unknown_prop');
    expect(know.propertyPolicy).toMatch(/unavailable/);
    expect(know.universalPolicy).toContain('Never fabricate');
  });

  it('returns property facts when row exists in DB', async () => {
    seedProperty({
      property_id: 'prop_A',
      check_in_instructions: 'Smart lock code is 1234*. Check-in is at 3:00 PM.',
      check_out_instructions: 'Leave keys on table. Checkout at 11:00 AM.',
      wifi_instructions: null,
      house_rules: null,
      property_policy: null,
      emergency_contacts: null,
      upsells: null,
      parking_instructions: null,
      payment_rules: null,
    });

    const know = await getGroundedKnowledge('prop_A');
    expect(know.checkInInstructions).toContain('1234*');
  });
});

// ─── IssueTriageClassifier ────────────────────────────────────────────────────

describe('IssueTriageClassifier', () => {
  it('classifies lockout as emergency', () => {
    const p = classifyIssuePriority(
      'urgent no entry to the apartment',
      IntentCategory.IssueReport,
      { isUrgent: true, isAccessRelated: true, mentionsGuest: false, mentionsTime: false, mentionsObject: true },
    );
    expect(p).toBe('emergency');
  });

  it('classifies wifi issue as urgent', () => {
    const p = classifyIssuePriority(
      'wifi not working',
      IntentCategory.IssueReport,
      { isUrgent: false, isAccessRelated: false, mentionsGuest: false, mentionsTime: false, mentionsObject: false },
    );
    expect(p).toBe('urgent');
  });
});

// ─── ActionPolicyGuard ────────────────────────────────────────────────────────

describe('ActionPolicyGuard', () => {
  beforeEach(resetAll);

  it('escalates emergency', async () => {
    const ctx = await buildCommunicationContext(123, '', { intent: IntentCategory.IssueReport, confidence: 0.9 }, []);
    const safety = evaluateActionSafety(ctx, 'fire in kitchen');
    expect(safety.safe).toBe(false);
    expect(safety.action).toBe('escalate_to_operator');
  });

  it('asks clarifying question on ambiguous intent', async () => {
    const ctx = await buildCommunicationContext(123, '', { intent: IntentCategory.Unknown, confidence: 0.8 }, []);
    const safety = evaluateActionSafety(ctx, '?');
    expect(safety.safe).toBe(true);
    expect(safety.action).toBe('ask_clarifying_question');
  });
});
