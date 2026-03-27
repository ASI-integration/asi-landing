/**
 * Tests for getPropertyTemplates()
 *
 * Covers: data present, no row, partial data, DB error, and missing maybeSingle
 * (the last two simulate prod-safe fallback-to-null behaviour).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Supabase mock ────────────────────────────────────────────────────────────

type MaybeResult = { data: Record<string, unknown> | null; error: { message: string } | null };

let mockResult: MaybeResult = { data: null, error: null };
let mockThrow = false;

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            if (mockThrow) throw new Error('simulated DB failure');
            return mockResult;
          },
        }),
      }),
    }),
  },
}));

import { getPropertyTemplates } from '../templates';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('getPropertyTemplates', () => {
  beforeEach(() => {
    mockThrow = false;
    mockResult = { data: null, error: null };
  });

  it('returns null when no row exists for the property', async () => {
    mockResult = { data: null, error: null };
    const result = await getPropertyTemplates('prop_missing');
    expect(result).toBeNull();
  });

  it('returns null on DB error', async () => {
    mockResult = { data: null, error: { message: 'connection refused' } };
    const result = await getPropertyTemplates('prop_A');
    expect(result).toBeNull();
  });

  it('returns null when exception is thrown (e.g. mock without maybeSingle)', async () => {
    mockThrow = true;
    const result = await getPropertyTemplates('prop_A');
    expect(result).toBeNull();
  });

  it('returns null when row exists but all template fields are null', async () => {
    mockResult = {
      data: {
        pre_checkin_template:    null,
        checkout_template:       null,
        followup_template:       null,
        escalation_contact_text: null,
      },
      error: null,
    };
    const result = await getPropertyTemplates('prop_A');
    expect(result).toBeNull();
  });

  it('returns templates when pre_checkin_template is set', async () => {
    mockResult = {
      data: {
        pre_checkin_template:    'Welcome! Your code is 1234.',
        checkout_template:       null,
        followup_template:       null,
        escalation_contact_text: null,
      },
      error: null,
    };
    const result = await getPropertyTemplates('prop_A');
    expect(result).not.toBeNull();
    expect(result!.pre_checkin_template).toBe('Welcome! Your code is 1234.');
    expect(result!.checkout_template).toBeNull();
  });

  it('returns all 4 fields when fully set', async () => {
    mockResult = {
      data: {
        pre_checkin_template:    'Pre-checkin text',
        checkout_template:       'Checkout text',
        followup_template:       'Followup text',
        escalation_contact_text: 'Call +7-XXX',
      },
      error: null,
    };
    const result = await getPropertyTemplates('prop_A');
    expect(result).toEqual({
      pre_checkin_template:    'Pre-checkin text',
      checkout_template:       'Checkout text',
      followup_template:       'Followup text',
      escalation_contact_text: 'Call +7-XXX',
    });
  });
});
