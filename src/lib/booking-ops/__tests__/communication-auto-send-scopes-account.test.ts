import { beforeEach, describe, expect, it, vi } from 'vitest';

type ScopeRow = Record<string, unknown>;
const rows: ScopeRow[] = [];

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table !== 'booking_ops_communication_auto_send_scopes') {
        throw new Error('unexpected_table');
      }
      const query = {
        select: vi.fn(() => query),
        order: vi.fn(async () => ({ data: [...rows], error: null })),
      };
      return query;
    }),
  },
}));

const baseScope = (overrides: ScopeRow = {}): ScopeRow => ({
  id: 'scope-1',
  account_id: null,
  scope_type: 'global',
  scope_ref: null,
  actual_send_enabled: false,
  enabled_by: null,
  enabled_at: null,
  disabled_at: new Date().toISOString(),
  reason: null,
  max_batch_size: 10,
  allowed_channels: ['telegram', 'email'],
  allowed_message_types: ['cleaner_task_assignment'],
  dry_run_only: true,
  emergency_stop: false,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

describe('account-scoped auto-send scope resolution', () => {
  beforeEach(() => {
    rows.length = 0;
    rows.push(baseScope());
  });

  it('selects only the booking scope for the requested account when refs collide', async () => {
    rows.push(
      baseScope({
        id: 'scope-a',
        account_id: 'account-1',
        scope_type: 'booking',
        scope_ref: 'shared-booking',
        actual_send_enabled: true,
        dry_run_only: false,
      }),
      baseScope({
        id: 'scope-b',
        account_id: 'account-2',
        scope_type: 'booking',
        scope_ref: 'shared-booking',
        actual_send_enabled: true,
        dry_run_only: false,
      }),
    );

    const { resolveAutoSendScope } = await import('../communication-auto-send-scopes');
    const result = await resolveAutoSendScope({
      accountId: 'account-1',
      bookingId: 'shared-booking',
      channel: 'telegram',
      messageType: 'cleaner_task_assignment',
    });

    expect(result.enabled).toBe(true);
    expect(result.scope).toMatchObject({
      id: 'scope-a',
      accountId: 'account-1',
      scopeType: 'booking',
      scopeRef: 'shared-booking',
    });
  });

  it('does not use another account booking scope with the same reference', async () => {
    rows.push(baseScope({
      id: 'scope-b',
      account_id: 'account-2',
      scope_type: 'booking',
      scope_ref: 'shared-booking',
      actual_send_enabled: true,
      dry_run_only: false,
    }));

    const { resolveAutoSendScope } = await import('../communication-auto-send-scopes');
    const result = await resolveAutoSendScope({
      accountId: 'account-1',
      bookingId: 'shared-booking',
      channel: 'telegram',
      messageType: 'cleaner_task_assignment',
    });

    expect(result).toMatchObject({ enabled: false, error: 'scope_disabled' });
  });

  it('does not let an unbound legacy owner scope authorize account-scoped execution', async () => {
    rows.push(baseScope({
      id: 'legacy-owner',
      account_id: null,
      scope_type: 'owner',
      scope_ref: 'owner-legacy',
      actual_send_enabled: true,
      dry_run_only: false,
    }));

    const { resolveAutoSendScope } = await import('../communication-auto-send-scopes');
    const result = await resolveAutoSendScope({
      accountId: 'account-1',
      ownerId: 'owner-legacy',
      channel: 'telegram',
      messageType: 'cleaner_task_assignment',
    });

    expect(result).toMatchObject({ enabled: false, error: 'scope_disabled' });
  });
});
