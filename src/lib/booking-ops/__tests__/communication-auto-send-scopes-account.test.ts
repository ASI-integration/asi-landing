import { beforeEach, describe, expect, it, vi } from 'vitest';

type ScopeRow = Record<string, unknown>;
const rows: ScopeRow[] = [];
const runRows: ScopeRow[] = [];
let runReadError = false;

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      const source =
        table === 'booking_ops_communication_auto_send_scopes'
          ? rows
          : table === 'booking_ops_communication_auto_send_runs'
            ? runRows
            : null;
      if (!source) throw new Error('unexpected_table');

      let matches = (_row: ScopeRow) => true;
      let limit = Number.POSITIVE_INFINITY;
      const result = () => ({
        data: source.filter(matches).slice(0, limit),
        error: table === 'booking_ops_communication_auto_send_runs' && runReadError
          ? { message: 'run_read_failed' }
          : null,
      });
      const query: any = {
        select: vi.fn(() => query),
        eq: vi.fn((key: string, value: unknown) => {
          const previous = matches;
          matches = (row: ScopeRow) => previous(row) && row[key] === value;
          return query;
        }),
        order: vi.fn(() => query),
        limit: vi.fn((value: number) => {
          limit = value;
          return query;
        }),
        maybeSingle: vi.fn(async () => {
          const current = result();
          return { ...current, data: current.data?.[0] ?? null };
        }),
        then: (resolve: (value: unknown) => void) => resolve(result()),
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
    vi.unstubAllEnvs();
    rows.length = 0;
    runRows.length = 0;
    runReadError = false;
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

  it('requires a live Telegram sender runtime for property readiness', async () => {
    rows.push(baseScope({
      id: 'property-live',
      account_id: 'account-1',
      scope_type: 'property',
      scope_ref: 'property-1',
      actual_send_enabled: true,
      allowed_channels: ['telegram'],
      dry_run_only: false,
    }));

    const { isAutoSendOperationallyReadyForProperty } = await import('../communication-auto-send-scopes');
    await expect(isAutoSendOperationallyReadyForProperty('account-1', 'property-1')).resolves.toBe(false);

    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'configured');
    vi.stubEnv('DRY_RUN_TELEGRAM_OUTBOUND', '1');
    await expect(isAutoSendOperationallyReadyForProperty('account-1', 'property-1')).resolves.toBe(false);

    vi.stubEnv('DRY_RUN_TELEGRAM_OUTBOUND', '0');
    await expect(isAutoSendOperationallyReadyForProperty('account-1', 'property-1')).resolves.toBe(true);
  });

  it('requires live SMTP mode for email property readiness', async () => {
    rows.push(baseScope({
      id: 'property-email',
      account_id: 'account-1',
      scope_type: 'property',
      scope_ref: 'property-1',
      actual_send_enabled: true,
      allowed_channels: ['email'],
      dry_run_only: false,
    }));

    const { isAutoSendOperationallyReadyForProperty } = await import('../communication-auto-send-scopes');

    vi.stubEnv('EMAIL_AUTO_SEND', 'true');
    vi.stubEnv('EMAIL_DRAFT_ONLY', 'true');
    vi.stubEnv('EMAIL_SMTP_HOST', 'smtp.example.test');
    vi.stubEnv('EMAIL_FROM_ADDRESS', 'support@example.test');
    await expect(isAutoSendOperationallyReadyForProperty('account-1', 'property-1')).resolves.toBe(false);

    vi.stubEnv('EMAIL_DRAFT_ONLY', 'false');
    await expect(isAutoSendOperationallyReadyForProperty('account-1', 'property-1')).resolves.toBe(true);
  });

  it('fails property readiness after a known failed auto-send run', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'configured');
    vi.stubEnv('DRY_RUN_TELEGRAM_OUTBOUND', '0');
    rows.push(baseScope({
      id: 'property-live',
      account_id: 'account-1',
      scope_type: 'property',
      scope_ref: 'property-1',
      actual_send_enabled: true,
      allowed_channels: ['telegram'],
      dry_run_only: false,
    }));
    runRows.push({
      account_id: 'account-1',
      status: 'completed',
      failed_count: 1,
      started_at: '2026-10-05T18:00:00.000Z',
    });

    const { isAutoSendOperationallyReadyForProperty } = await import('../communication-auto-send-scopes');
    await expect(isAutoSendOperationallyReadyForProperty('account-1', 'property-1')).resolves.toBe(false);

    runRows[0].failed_count = 0;
    await expect(isAutoSendOperationallyReadyForProperty('account-1', 'property-1')).resolves.toBe(true);

    runReadError = true;
    await expect(isAutoSendOperationallyReadyForProperty('account-1', 'property-1')).resolves.toBe(false);
  });

  it('fails property readiness for dry-run, emergency-stop, or foreign scope', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'configured');
    vi.stubEnv('DRY_RUN_TELEGRAM_OUTBOUND', '0');

    const { isAutoSendOperationallyReadyForProperty } = await import('../communication-auto-send-scopes');

    rows.push(baseScope({
      id: 'property-dry',
      account_id: 'account-1',
      scope_type: 'property',
      scope_ref: 'property-1',
      actual_send_enabled: true,
      allowed_channels: ['telegram'],
      dry_run_only: true,
    }));
    await expect(isAutoSendOperationallyReadyForProperty('account-1', 'property-1')).resolves.toBe(false);

    rows.length = 0;
    rows.push(
      baseScope({ emergency_stop: true }),
      baseScope({
        id: 'property-live',
        account_id: 'account-1',
        scope_type: 'property',
        scope_ref: 'property-1',
        actual_send_enabled: true,
        allowed_channels: ['telegram'],
        dry_run_only: false,
      }),
    );
    await expect(isAutoSendOperationallyReadyForProperty('account-1', 'property-1')).resolves.toBe(false);

    rows.length = 0;
    rows.push(
      baseScope(),
      baseScope({
        id: 'foreign-property',
        account_id: 'account-2',
        scope_type: 'property',
        scope_ref: 'property-1',
        actual_send_enabled: true,
        allowed_channels: ['telegram'],
        dry_run_only: false,
      }),
    );
    await expect(isAutoSendOperationallyReadyForProperty('account-1', 'property-1')).resolves.toBe(false);
  });
});
