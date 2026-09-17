import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * ensureAccountForUser(deferTrial: true) is called from every international
 * entry point that can create OR touch an account: signup, Google OAuth,
 * Google OAuth callback, the (orphaned but still guarded) onboarding lead
 * endpoint, and — critically — login, which runs on every returning
 * session, not just first signup. This file proves the "existing
 * membership" branch never grants a trial on a repeat call, which is the
 * exact bug this test was written to catch: /api/auth/login used to call
 * ensureAccountForUser with the legacy 7-day-trial defaults unconditionally,
 * so simply logging back in would silently backfill trial_started_at for an
 * account that should still be sitting at lifecycle_status='signup'.
 */

type AccountRow = Record<string, any>;
type MembershipRow = { account_id: string; role: string };

let accounts: Map<string, AccountRow>;
let membershipsByUser: Map<string, MembershipRow>;

function makeAccountMembersTable() {
  return {
    select: (_cols: string) => ({
      eq: (_col: string, userId: string) => ({
        order: () => ({
          limit: () => ({
            maybeSingle: async () => {
              const membership = membershipsByUser.get(userId);
              if (!membership) return { data: null, error: null };
              const acct = accounts.get(membership.account_id);
              return {
                data: {
                  account_id: membership.account_id,
                  role: membership.role,
                  accounts: acct
                    ? {
                        id: acct.id,
                        plan_code: acct.plan_code,
                        trial_started_at: acct.trial_started_at,
                        trial_ends_at: acct.trial_ends_at,
                        subscription_status: acct.subscription_status,
                      }
                    : null,
                },
                error: null,
              };
            },
          }),
        }),
      }),
    }),
  };
}

function makeAccountsTable() {
  return {
    insert: (row: AccountRow) => ({
      select: (_cols: string) => ({
        single: async () => {
          const id = `acc_${accounts.size + 1}`;
          accounts.set(id, { id, ...row });
          return { data: { id }, error: null };
        },
      }),
    }),
    update: (patch: Record<string, any>) => ({
      eq: (_col: string, accountId: string) => {
        const row = accounts.get(accountId);
        if (row) accounts.set(accountId, { ...row, ...patch });
        return Promise.resolve({ error: null });
      },
    }),
  };
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'accounts') return makeAccountsTable();
      if (table === 'account_members') {
        return {
          ...makeAccountMembersTable(),
          insert: (row: { account_id: string; user_id: string; role: string }) => {
            membershipsByUser.set(row.user_id, { account_id: row.account_id, role: row.role });
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  },
}));

import { ensureAccountForUser } from '../../accounts';

beforeEach(() => {
  accounts = new Map();
  membershipsByUser = new Map();
});

describe('ensureAccountForUser(deferTrial: true)', () => {
  it('scenario K: first call creates the account at lifecycle_status=signup with no trial fields', async () => {
    const result = await ensureAccountForUser({ userId: 'user_1', email: 'a@example.com', deferTrial: true });
    expect(result.created).toBe(true);
    const row = accounts.get(result.accountId)!;
    expect(row.lifecycle_status).toBe('signup');
    expect(row.trial_started_at).toBeUndefined();
    expect(row.trial_ends_at).toBeUndefined();
  });

  it('a repeat call (e.g. a subsequent login) on an existing deferred account does not grant a trial', async () => {
    const first = await ensureAccountForUser({ userId: 'user_1', email: 'a@example.com', deferTrial: true });
    expect(first.created).toBe(true);

    // Simulate the account progressing partway through the real lifecycle
    // via the billing module (not through ensureAccountForUser) — it should
    // stay untouched by any further ensureAccountForUser call.
    accounts.set(first.accountId, {
      ...accounts.get(first.accountId),
      lifecycle_status: 'integration_in_progress',
    });

    const second = await ensureAccountForUser({ userId: 'user_1', email: 'a@example.com', deferTrial: true });
    expect(second.created).toBe(false);
    expect(second.accountId).toBe(first.accountId);

    const row = accounts.get(first.accountId)!;
    expect(row.lifecycle_status).toBe('integration_in_progress'); // untouched
    expect(row.trial_started_at).toBeFalsy();
    expect(row.trial_ends_at).toBeFalsy();
  });

  it('the non-deferred (RU/legacy) path still grants the immediate trial — unchanged behavior', async () => {
    const result = await ensureAccountForUser({ userId: 'user_ru', email: 'ru@example.com', trialDays: 7 });
    const row = accounts.get(result.accountId)!;
    expect(row.subscription_status).toBe('trial');
    expect(row.trial_started_at).toBeTruthy();
    expect(row.trial_ends_at).toBeTruthy();
    expect(row.lifecycle_status).toBeUndefined();
  });
});
