import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── In-memory Supabase fake ────────────────────────────────────────────────
// Two tables only: accounts (one row, keyed by id) and integration_requirements
// (rows keyed by account_id+type). Enough surface to exercise the real
// orchestration code in account-lifecycle.ts without a live database.

type AccountRow = Record<string, any>;
type RequirementRow = Record<string, any>;

let accounts: Map<string, AccountRow>;
let requirements: RequirementRow[];

function makeAccountsTable() {
  return {
    select: (_cols?: string) => ({
      eq: (_col: string, val: string) => ({
        single: async () => {
          const row = accounts.get(val);
          return row ? { data: row, error: null } : { data: null, error: { message: 'not found' } };
        },
      }),
    }),
    update: (patch: Record<string, any>) => ({
      eq: (_col: string, val: string) => {
        const row = accounts.get(val);
        if (row) accounts.set(val, { ...row, ...patch });
        return Promise.resolve({ error: row ? null : { message: 'not found' } });
      },
    }),
  };
}

function makeRequirementsTable() {
  return {
    // defineIntegrationRequirement: .select('id').eq(account_id).eq(type).maybeSingle()
    // fetchRequirements:            .select('*').eq(account_id) — awaited directly, no maybeSingle/second .eq
    select: (cols?: string) => {
      if (cols === '*') {
        return {
          eq: (col: string, val: string) =>
            Promise.resolve({ data: requirements.filter((r) => r[col] === val), error: null }),
        };
      }
      return {
        eq: (colA: string, valA: string) => ({
          eq: (colB: string, valB: string) => ({
            maybeSingle: async () => {
              const row = requirements.find((r) => r[colA] === valA && r[colB] === valB);
              return { data: row ?? null, error: null };
            },
          }),
        }),
      };
    },
    insert: (row: RequirementRow) => {
      requirements.push({
        ...row,
        id: `req_${requirements.length + 1}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      return Promise.resolve({ error: null });
    },
    update: (patch: Record<string, any>) => ({
      eq: (colA: string, valA: string) => ({
        eq: (colB: string, valB: string) => ({
          select: (_cols?: string) => {
            const matches = requirements.filter((r) => r[colA] === valA && r[colB] === valB);
            matches.forEach((r) => Object.assign(r, patch));
            return Promise.resolve({ data: matches.map((r) => ({ id: r.id })), error: null });
          },
        }),
      }),
    }),
  };
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'accounts') return makeAccountsTable();
      if (table === 'integration_requirements') return makeRequirementsTable();
      throw new Error(`unexpected table ${table}`);
    },
  },
}));

vi.mock('@/lib/billing/config', () => ({
  isInternationalBillingEnabled: vi.fn(() => false),
}));

import {
  markCardVerified,
  defineIntegrationRequirement,
  acceptIntegrationRequirement,
  requestPaidActivation,
  getAccountLifecycle,
} from '../account-lifecycle';
import { isInternationalBillingEnabled } from '../config';

function seedAccount(id: string, overrides: Partial<AccountRow> = {}) {
  accounts.set(id, {
    id,
    lifecycle_status: 'signup',
    card_verified_at: null,
    integration_started_at: null,
    integration_ready_at: null,
    trial_started_at: null,
    trial_ends_at: null,
    billing_started_at: null,
    stripe_customer_id: null,
    stripe_payment_method_id: null,
    stripe_setup_intent_id: null,
    accepted_plan_id: null,
    billing_consent_at: null,
    ...overrides,
  });
}

beforeEach(() => {
  accounts = new Map();
  requirements = [];
  vi.mocked(isInternationalBillingEnabled).mockReturnValue(false);
});

describe('markCardVerified', () => {
  it('scenario A: persists card_verified + integration_in_progress, no trial fields touched', async () => {
    seedAccount('acc_1');
    const state = await markCardVerified(
      'acc_1',
      { stripeCustomerId: 'cus_1', stripePaymentMethodId: 'pm_1', stripeSetupIntentId: 'seti_1' },
      new Date('2026-01-01T00:00:00Z'),
    );
    expect(state.status).toBe('integration_in_progress');
    expect(state.timestamps.trialStartedAt).toBeNull();

    const row = accounts.get('acc_1')!;
    expect(row.stripe_customer_id).toBe('cus_1');
    expect(row.stripe_payment_method_id).toBe('pm_1');
    expect(row.card_verified_at).toBe('2026-01-01T00:00:00.000Z');
    expect(row.lifecycle_status).toBe('integration_in_progress');
  });

  it('is idempotent on a duplicate webhook delivery', async () => {
    seedAccount('acc_1');
    const refs = { stripeCustomerId: 'cus_1', stripePaymentMethodId: 'pm_1', stripeSetupIntentId: 'seti_1' };
    await markCardVerified('acc_1', refs, new Date('2026-01-01T00:00:00Z'));
    const second = await markCardVerified('acc_1', refs, new Date('2026-01-02T00:00:00Z'));
    // Second call must not regress state or move card_verified_at forward.
    expect(second.status).toBe('integration_in_progress');
    expect(accounts.get('acc_1')!.card_verified_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('does not swap the saved payment method on a duplicate delivery carrying different Stripe refs', async () => {
    seedAccount('acc_1');
    await markCardVerified(
      'acc_1',
      { stripeCustomerId: 'cus_1', stripePaymentMethodId: 'pm_1', stripeSetupIntentId: 'seti_1' },
      new Date('2026-01-01T00:00:00Z'),
    );
    // A different SetupIntent's success event replayed/misdelivered for the same account.
    await markCardVerified(
      'acc_1',
      { stripeCustomerId: 'cus_1', stripePaymentMethodId: 'pm_DIFFERENT', stripeSetupIntentId: 'seti_2' },
      new Date('2026-01-05T00:00:00Z'),
    );
    expect(accounts.get('acc_1')!.stripe_payment_method_id).toBe('pm_1');
    expect(accounts.get('acc_1')!.stripe_setup_intent_id).toBe('seti_1');
  });

  it('scenario L: rejects when the account has never signed up onto the lifecycle (legacy/NULL account)', async () => {
    seedAccount('acc_1', { lifecycle_status: null });
    await expect(
      markCardVerified('acc_1', { stripeCustomerId: 'cus_1', stripePaymentMethodId: 'pm_1', stripeSetupIntentId: 'seti_1' }),
    ).rejects.toThrow(/not on the new lifecycle/);
  });
});

describe('acceptIntegrationRequirement', () => {
  it('scenario B: not ready while a required requirement is still pending', async () => {
    seedAccount('acc_1', { lifecycle_status: 'integration_in_progress', integration_started_at: '2026-01-01T00:05:00.000Z' });
    await defineIntegrationRequirement('acc_1', 'channel_manager', 'Channel Manager', true);
    await defineIntegrationRequirement('acc_1', 'access_system', 'Access System', true);

    const result = await acceptIntegrationRequirement('acc_1', 'channel_manager', { note: 'ok' }, new Date('2026-01-31T00:00:00Z'));
    expect(result.integrationReady).toBe(false);
    expect(accounts.get('acc_1')!.lifecycle_status).toBe('integration_in_progress');
    expect(accounts.get('acc_1')!.trial_started_at).toBeNull();
  });

  it('scenario C: integration_ready + trial_active fire together once the last required item is accepted', async () => {
    seedAccount('acc_1', { lifecycle_status: 'integration_in_progress', integration_started_at: '2026-01-01T00:05:00.000Z' });
    await defineIntegrationRequirement('acc_1', 'channel_manager', 'Channel Manager', true);
    await defineIntegrationRequirement('acc_1', 'access_system', 'Access System', true);

    await acceptIntegrationRequirement('acc_1', 'channel_manager', {}, new Date('2026-01-20T00:00:00Z'));
    const final = await acceptIntegrationRequirement('acc_1', 'access_system', {}, new Date('2026-01-31T00:00:00Z'));

    expect(final.integrationReady).toBe(true);
    expect(final.state.status).toBe('trial_active');
    expect(final.state.timestamps.integrationReadyAt).toEqual(new Date('2026-01-31T00:00:00Z'));
    expect(final.state.timestamps.trialStartedAt).toEqual(new Date('2026-01-31T00:00:00Z'));
  });

  it('scenario I: a repeated acceptance callback does not reset the trial window', async () => {
    seedAccount('acc_1', { lifecycle_status: 'integration_in_progress', integration_started_at: '2026-01-01T00:05:00.000Z' });
    await defineIntegrationRequirement('acc_1', 'channel_manager', 'Channel Manager', true);

    const first = await acceptIntegrationRequirement('acc_1', 'channel_manager', {}, new Date('2026-01-10T00:00:00Z'));
    expect(first.state.timestamps.trialStartedAt).toEqual(new Date('2026-01-10T00:00:00Z'));

    // Duplicate ops callback, or a retried request, weeks later.
    const second = await acceptIntegrationRequirement('acc_1', 'channel_manager', {}, new Date('2026-02-01T00:00:00Z'));
    expect(second.state.timestamps.trialStartedAt).toEqual(new Date('2026-01-10T00:00:00Z'));
  });

  it('fails closed when the requirement was never defined', async () => {
    seedAccount('acc_1', { lifecycle_status: 'integration_in_progress' });
    await expect(acceptIntegrationRequirement('acc_1', 'channel_manager', {})).rejects.toThrow(/never defined/);
  });

  it('scenario L: rejects acceptance for an account still at signup (card required before integration)', async () => {
    seedAccount('acc_1', { lifecycle_status: 'signup' });
    await defineIntegrationRequirement('acc_1', 'channel_manager', 'Channel Manager', true);
    await expect(acceptIntegrationRequirement('acc_1', 'channel_manager', {})).rejects.toThrow(
      /cannot accept integration from status "signup"/,
    );
  });

  it('scenario M: a duplicate acceptance after trial_active leaves the original timestamps untouched', async () => {
    seedAccount('acc_1', { lifecycle_status: 'integration_in_progress', integration_started_at: '2026-01-01T00:05:00.000Z' });
    await defineIntegrationRequirement('acc_1', 'channel_manager', 'Channel Manager', true);

    const first = await acceptIntegrationRequirement('acc_1', 'channel_manager', {}, new Date('2026-01-10T00:00:00Z'));
    expect(first.state.status).toBe('trial_active');

    const dup = await acceptIntegrationRequirement('acc_1', 'channel_manager', { retried: true }, new Date('2026-03-01T00:00:00Z'));
    expect(dup.state.timestamps.integrationReadyAt).toEqual(new Date('2026-01-10T00:00:00Z'));
    expect(dup.state.timestamps.trialStartedAt).toEqual(new Date('2026-01-10T00:00:00Z'));
    expect(dup.state.timestamps.trialEndsAt).toEqual(new Date('2026-01-24T00:00:00Z'));
  });

  it('scenario N: refuses to touch a legacy/migrated account (lifecycle_status NULL)', async () => {
    seedAccount('acc_1', {
      lifecycle_status: null,
      subscription_status: 'active',
      trial_started_at: '2025-06-01T00:00:00.000Z',
      trial_ends_at: '2025-06-08T00:00:00.000Z',
    });
    await defineIntegrationRequirement('acc_1', 'channel_manager', 'Channel Manager', true);
    await expect(acceptIntegrationRequirement('acc_1', 'channel_manager', {})).rejects.toThrow(
      /not on the new lifecycle/,
    );
    // Untouched — no unexpected trial reset on the legacy fields.
    const row = accounts.get('acc_1')!;
    expect(row.subscription_status).toBe('active');
    expect(row.trial_started_at).toBe('2025-06-01T00:00:00.000Z');
    expect(row.trial_ends_at).toBe('2025-06-08T00:00:00.000Z');
  });
});

describe('scenario K: signup produces no trial timestamps', () => {
  it('a freshly seeded signup-status account has every timestamp null', () => {
    seedAccount('acc_1', { lifecycle_status: 'signup' });
    const row = accounts.get('acc_1')!;
    expect(row.card_verified_at).toBeNull();
    expect(row.integration_started_at).toBeNull();
    expect(row.integration_ready_at).toBeNull();
    expect(row.trial_started_at).toBeNull();
    expect(row.trial_ends_at).toBeNull();
    expect(row.billing_started_at).toBeNull();
  });
});

describe('requestPaidActivation — scenario J: no live charge/subscription possible from this flow', () => {
  it('always rejects while INTERNATIONAL_BILLING_ENABLED is false, regardless of how complete the account is', async () => {
    const trialEndsAt = '2026-01-24T00:00:00.000Z';
    seedAccount('acc_1', {
      lifecycle_status: 'trial_active',
      integration_ready_at: '2026-01-10T00:00:00.000Z',
      trial_started_at: '2026-01-10T00:00:00.000Z',
      trial_ends_at: trialEndsAt,
      stripe_payment_method_id: 'pm_1',
    });

    await expect(
      requestPaidActivation(
        'acc_1',
        { acceptedPlanId: 'plan_small', billingConsentAt: new Date('2026-01-25T00:00:00Z') },
        new Date('2026-01-25T00:00:00Z'),
      ),
    ).rejects.toThrow(/billing feature is disabled/);

    // Confirmed unchanged — no partial mutation on rejection.
    expect(accounts.get('acc_1')!.lifecycle_status).toBe('trial_active');
    expect(accounts.get('acc_1')!.billing_started_at).toBeNull();
  });

  it('rejects before trial end even if billing were enabled', async () => {
    vi.mocked(isInternationalBillingEnabled).mockReturnValue(true);
    seedAccount('acc_1', {
      lifecycle_status: 'trial_active',
      integration_ready_at: '2026-01-10T00:00:00.000Z',
      trial_started_at: '2026-01-10T00:00:00.000Z',
      trial_ends_at: '2026-01-24T00:00:00.000Z',
      stripe_payment_method_id: 'pm_1',
    });

    await expect(
      requestPaidActivation(
        'acc_1',
        { acceptedPlanId: 'plan_small', billingConsentAt: new Date('2026-01-15T00:00:00Z') },
        new Date('2026-01-15T00:00:00Z'), // before trial_ends_at
      ),
    ).rejects.toThrow(/trial has not ended/);
  });

  it('scenario N: refuses paid activation for a legacy/migrated account (lifecycle_status NULL)', async () => {
    seedAccount('acc_1', { lifecycle_status: null, subscription_status: 'active' });
    await expect(
      requestPaidActivation('acc_1', { acceptedPlanId: 'plan_small', billingConsentAt: new Date() }),
    ).rejects.toThrow(/not on the new lifecycle/);
  });
});

describe('getAccountLifecycle', () => {
  it('returns null for a legacy/migrated account instead of guessing a starting state', async () => {
    seedAccount('acc_1', { lifecycle_status: null });
    expect(await getAccountLifecycle('acc_1')).toBeNull();
  });

  it('returns the real state for a lifecycle-tracked account', async () => {
    seedAccount('acc_1', { lifecycle_status: 'signup' });
    const state = await getAccountLifecycle('acc_1');
    expect(state?.status).toBe('signup');
  });
});
