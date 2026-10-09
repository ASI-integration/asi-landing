import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;
const tables: Record<string, Row[]> = {
  booking_ops_communication_intents: [],
  booking_ops_communication_deliveries: [],
  booking_ops_records: [],
};

class Query {
  private filters: Array<(row: Row) => boolean> = [];
  private limitValue: number | null = null;
  private mode: 'select' | 'insert' | 'update' = 'select';
  private values: Row | Row[] | null = null;

  constructor(private table: string) {}
  select() { return this; }
  eq(field: string, value: unknown) {
    this.filters.push((row) => {
      if (field.startsWith('metadata->>')) return String(row.metadata?.[field.slice('metadata->>'.length)] ?? '') === String(value);
      return row[field] === value;
    });
    return this;
  }
  gte(field: string, value: unknown) { this.filters.push((row) => String(row[field]) >= String(value)); return this; }
  in(field: string, values: unknown[]) { this.filters.push((row) => values.includes(row[field])); return this; }
  order() { return this; }
  limit(value: number) { this.limitValue = value; return this; }
  insert(values: Row | Row[]) { this.mode = 'insert'; this.values = values; return this; }
  update(values: Row) { this.mode = 'update'; this.values = values; return this; }

  private run() {
    const rows = tables[this.table] ?? (tables[this.table] = []);
    if (this.mode === 'insert') {
      const incoming = Array.isArray(this.values) ? this.values : [this.values as Row];
      if (this.table === 'booking_ops_communication_deliveries'
        && incoming.some((item) => rows.some((row) => row.idempotency_key === item.idempotency_key))) {
        return { data: null, error: { message: 'duplicate key' } };
      }
      rows.push(...incoming.map((item) => ({ ...item })));
      return { data: incoming, error: null };
    }
    const matched = rows.filter((row) => this.filters.every((filter) => filter(row)));
    if (this.mode === 'update') {
      matched.forEach((row) => Object.assign(row, this.values));
    }
    const data = this.limitValue === null ? matched : matched.slice(0, this.limitValue);
    return { data, error: null };
  }

  async maybeSingle() {
    const result = this.run();
    return { ...result, data: Array.isArray(result.data) ? result.data[0] ?? null : result.data };
  }
  then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
    return Promise.resolve(this.run()).then(resolve, reject);
  }
}

// Unit-only RPC simulator: synchronous admission models serialization, NOT a
// PostgreSQL transaction/concurrency receipt. SQL acceptance stays BLOCK.
const quotaRows = new Map<string, { id: string; state: string; account: string; booking: string; guest: string }>();
let bookingCap: number | null = null;
let guestCap: number | null = null;
const quotaRpc = vi.fn(async (_name: string, args: Row): Promise<any> => {
  const delivery = tables.booking_ops_communication_deliveries.find(row => row.id === args.p_delivery_id);
  const denied = { data: { allowed: false }, error: null };
  if (!delivery || delivery.account_id !== args.p_account_id) return denied;
  let row = quotaRows.get(delivery.id);
  if (args.p_phase === 'reserve') {
    if (row) return denied;
    const own = [...quotaRows.values()].filter(q => q.account === delivery.account_id);
    if ((bookingCap !== null && own.filter(q => q.booking === delivery.booking_id).length >= bookingCap)
      || (guestCap !== null && own.filter(q => q.guest === delivery.recipient_ref).length >= guestCap)) return denied;
    row = { id: delivery.id, state: 'held', account: delivery.account_id,
      booking: delivery.booking_id, guest: delivery.recipient_ref };
    quotaRows.set(delivery.id, row);
    delivery.status = 'sending';
    delivery.attempt_count += 1;
  } else if (!row || row.id !== args.p_reservation_id) return denied;
  else if (args.p_phase === 'dispatch') {
    if (row.state !== 'held') return denied;
    row.state = 'dispatching';
  } else {
    if (row.state !== 'dispatching') return denied;
    row.state = args.p_phase;
  }
  return { data: { allowed: true, phase: args.p_phase, reservation_id: row.id, delivery_id: delivery.id }, error: null };
});

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (table: string) => new Query(table), rpc: (...args: [string, Row]) => quotaRpc(...args) },
}));

const requireBookingOpsRecordScope = vi.fn(async (..._args: unknown[]): Promise<any> => ({
  id: '11111111-1111-4111-8111-111111111111',
  bookingId: 'booking-1',
  propertyId: 'property-1',
  accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  guestTelegram: '123456',
  guestEmail: 'guest@example.test',
  guestIntake: null,
}));

vi.mock('@/lib/booking-ops/repository', () => ({
  getBookingOpsRecord: vi.fn(async () => ({
    id: '11111111-1111-4111-8111-111111111111',
    bookingId: 'booking-1',
    propertyId: 'property-1',
    accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    guestTelegram: '123456',
    guestEmail: 'guest@example.test',
    guestIntake: null,
  })),
  requireBookingOpsRecordScope: (...args: unknown[]) => requireBookingOpsRecordScope(args[0], args[1]),
}));

const policyDecision = vi.fn();
const recordAttempt = vi.fn(async (..._args: unknown[]) => ({ ok: true }));
vi.mock('@/lib/booking-ops/communication-auto-send-policy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../communication-auto-send-policy')>();
  return {
    ...actual,
    canAutoSendCommunicationIntent: (...args: unknown[]) => policyDecision(args[0], args[1]),
    recordAutoSendAttempt: (...args: unknown[]) => recordAttempt(args[0], args[1], args[2]),
  };
});

vi.mock('@/lib/communication/channels/telegram', () => ({ TelegramAdapter: class {} }));
vi.mock('@/lib/communication/channels/email', () => ({ EmailAdapter: class {} }));
vi.mock('@/lib/crm/api-auth', () => ({
  requireOpsAdminSession: vi.fn(async () => ({
    error: Response.json({ ok: false }, { status: 401 }),
  })),
}));

const enabledScope = {
  id: '44444444-4444-4444-8444-444444444444',
  scopeType: 'booking' as const,
  scopeRef: 'booking-1',
  actualSendEnabled: true,
  enabledBy: 'admin@example.test',
  enabledAt: '2026-07-01T09:00:00.000Z',
  disabledAt: null,
  reason: 'pilot',
  maxBatchSize: 10,
  allowedChannels: ['telegram' as const, 'email' as const],
  allowedMessageTypes: ['request_arrival_time', 'cleaner_task_assignment'],
  dryRunOnly: false,
  emergencyStop: false,
  createdAt: '2026-07-01T09:00:00.000Z',
  updatedAt: '2026-07-01T09:00:00.000Z',
};
const scopeDecision = vi.fn(async (_context?: unknown): Promise<any> => ({
  enabled: true,
  scope: { ...enabledScope },
  globalEmergencyStop: false,
}));
vi.mock('@/lib/booking-ops/communication-auto-send-scopes', () => ({
  resolveAutoSendScope: (...args: unknown[]) => scopeDecision(args[0]),
  startAutoSendRun: vi.fn(async () => 'run-1'),
  finishAutoSendRun: vi.fn(async () => undefined),
}));

import {
  enqueueAutoSendDelivery,
  executeAutoSendDelivery,
  getEligibleAutoSendIntents,
  recordDeliveryFailure,
  recordDeliverySuccess,
  skipDelivery,
} from '../communication-auto-send-executor';

const allowedDecision = {
  decision: 'allowed',
  allowed: true,
  reason: 'allowed',
  rule_key: 'policy.allowed',
  safe_to_display_summary: 'Можно отправить.',
  actual_send_enabled: true,
  policy_decision_id: '22222222-2222-4222-8222-222222222222',
};

function seedIntent(overrides: Row = {}) {
  const row = {
    id: '33333333-3333-4333-8333-333333333333',
    booking_ops_record_id: '11111111-1111-4111-8111-111111111111',
    booking_id: 'booking-1',
    related_task_id: null,
    actor_type: 'guest',
    actor_label: 'Гость',
    purpose: 'request_arrival_time',
    channel: 'telegram',
    status: 'draft_ready',
    message_text: 'Подскажите, пожалуйста, время прибытия.',
    message_template_key: 'guest.arrival.v1',
    metadata: { auto_send_eligible: true },
    created_at: '2026-07-01T09:00:00.000Z',
    updated_at: '2026-07-01T09:00:00.000Z',
    superseded_at: null,
    ...overrides,
  };
  tables.booking_ops_communication_intents.push(row);
  return row;
}

beforeEach(() => {
  quotaRows.clear();
  bookingCap = null;
  guestCap = null;
  quotaRpc.mockClear();
  tables.booking_ops_communication_intents = [];
  tables.booking_ops_communication_deliveries = [];
  tables.booking_ops_records = [{
    id: '11111111-1111-4111-8111-111111111111',
    account_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  }];
  policyDecision.mockReset();
  policyDecision.mockResolvedValue({ ...allowedDecision });
  requireBookingOpsRecordScope.mockReset();
  requireBookingOpsRecordScope.mockResolvedValue({
    id: '11111111-1111-4111-8111-111111111111',
    bookingId: 'booking-1',
    propertyId: 'property-1',
    accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  });
  recordAttempt.mockClear();
  scopeDecision.mockReset();
  scopeDecision.mockResolvedValue({ enabled: true, scope: { ...enabledScope }, globalEmergencyStop: false });
});

describe('controlled actual auto-send executor', () => {
  it('filters eligible queue candidates by canonical account ownership', async () => {
    seedIntent();
    const own = await getEligibleAutoSendIntents({ accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    const foreign = await getEligibleAutoSendIntents({ accountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    expect(own.ok && own.intents).toHaveLength(1);
    expect(foreign.ok && foreign.intents).toHaveLength(0);
  });

  it('rejects enqueue when the canonical booking belongs to another account', async () => {
    const intent = seedIntent();
    const result = await enqueueAutoSendDelivery(intent.id, {}, { accountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    expect(result).toMatchObject({ ok: false, error: 'booking_scope_mismatch' });
    expect(tables.booking_ops_communication_deliveries).toHaveLength(0);
  });

  it('fails closed if canonical booking scope changes before delivery enqueue persistence', async () => {
    const intent = seedIntent();
    requireBookingOpsRecordScope.mockRejectedValueOnce(new Error('booking_scope_mismatch'));

    const result = await enqueueAutoSendDelivery(intent.id);

    expect(result).toMatchObject({ ok: false, error: 'booking_scope_mismatch' });
    expect(requireBookingOpsRecordScope).toHaveBeenCalledWith(
      intent.booking_ops_record_id,
      { accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', propertyId: 'property-1' },
    );
    expect(tables.booking_ops_communication_deliveries).toHaveLength(0);
  });

  it('guards exported delivery status mutations with canonical booking scope', async () => {
    const intent = seedIntent({
      actor_type: 'cleaner',
      purpose: 'cleaner_task_assignment',
      metadata: { recipient_ref: 'staff-123' },
    });
    const queued = await enqueueAutoSendDelivery(intent.id);
    const deliveryId = queued.ok ? queued.delivery.id : '';
    const deliveryRow = tables.booking_ops_communication_deliveries[0];
    const expectedScope = { accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', propertyId: 'property-1' };

    for (const mutate of [
      () => recordDeliverySuccess(deliveryId, 'provider-1', {}, expectedScope),
      () => recordDeliveryFailure(deliveryId, 'provider_rejected', {}, expectedScope),
      () => skipDelivery(deliveryId, 'manual_skip', {}, expectedScope),
    ]) {
      requireBookingOpsRecordScope.mockReset();
      requireBookingOpsRecordScope.mockRejectedValueOnce(new Error('booking_scope_mismatch'));
      const before = deliveryRow.status;
      await expect(mutate()).resolves.toBeNull();
      expect(deliveryRow.status).toBe(before);
    }
  });

  it('rechecks account ownership immediately before delivery execution', async () => {
    const intent = seedIntent({ actor_type: 'cleaner', purpose: 'cleaner_task_assignment', metadata: { recipient_ref: 'staff-123' } });
    const queued = await enqueueAutoSendDelivery(intent.id);
    const sender = vi.fn(async () => ({ ok: true }));
    const result = await executeAutoSendDelivery(queued.ok ? queued.delivery.id : '', { accountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', sender });
    expect(result).toMatchObject({ ok: false, error: 'booking_scope_mismatch' });
    expect(sender).not.toHaveBeenCalled();
  });

  it('blocks send when canonical scope changes before quota admission', async () => {
    const intent = seedIntent({ actor_type: 'cleaner', purpose: 'cleaner_task_assignment', metadata: { recipient_ref: 'staff-123' } });
    const queued = await enqueueAutoSendDelivery(intent.id);
    requireBookingOpsRecordScope.mockReset();
    requireBookingOpsRecordScope
      .mockResolvedValueOnce({ id: intent.booking_ops_record_id, bookingId: 'booking-1', accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', propertyId: 'property-1' })
      .mockRejectedValueOnce(new Error('booking_scope_mismatch'));
    const sender = vi.fn(async () => ({ ok: true }));

    const result = await executeAutoSendDelivery(queued.ok ? queued.delivery.id : '', { sender });

    expect(result).toMatchObject({ ok: false, error: 'booking_scope_mismatch', delivery: { status: 'blocked' } });
    expect(sender).not.toHaveBeenCalled();
  });

  it('does not mutate delivery or intent state if scope changes after the provider call', async () => {
    const intent = seedIntent({
      actor_type: 'cleaner',
      purpose: 'cleaner_task_assignment',
      metadata: { recipient_ref: 'staff-123' },
    });
    const queued = await enqueueAutoSendDelivery(intent.id);
    requireBookingOpsRecordScope.mockReset();
    requireBookingOpsRecordScope
      .mockResolvedValueOnce({ id: intent.booking_ops_record_id, bookingId: 'booking-1', accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', propertyId: 'property-1' })
      .mockResolvedValueOnce({ id: intent.booking_ops_record_id, bookingId: 'booking-1', accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', propertyId: 'property-1' })
      .mockRejectedValueOnce(new Error('booking_scope_mismatch'));
    const sender = vi.fn(async () => ({ ok: true, providerMessageId: 'provider-1' }));

    const result = await executeAutoSendDelivery(queued.ok ? queued.delivery.id : '', { sender });

    expect(result).toMatchObject({ ok: true, delivery: null, deliveryStatusDeferred: true });
    expect(sender).toHaveBeenCalledTimes(1);
    expect(tables.booking_ops_communication_deliveries[0]?.status).toBe('sending');
    expect(tables.booking_ops_communication_intents[0]?.status).toBe('draft_ready');
  });

  it('sends an allowlisted guest message only with explicit actual-send policy permission', async () => {
    const intent = seedIntent();
    const queued = await enqueueAutoSendDelivery(intent.id);
    const sender = vi.fn(async () => ({ ok: true, providerMessageId: 'guest-provider-1' }));
    const result = await executeAutoSendDelivery(queued.ok ? queued.delivery.id : '', { sender });
    expect(result).toMatchObject({ ok: true, delivery: { status: 'sent', providerMessageId: 'guest-provider-1' } });
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it('blocks actual delivery when policy allows queueing but actual send remains disabled', async () => {
    policyDecision.mockResolvedValue({ ...allowedDecision, actual_send_enabled: false });
    const intent = seedIntent();
    const queued = await enqueueAutoSendDelivery(intent.id);
    const sender = vi.fn(async () => ({ ok: true }));
    const result = await executeAutoSendDelivery(queued.ok ? queued.delivery.id : '', { sender });
    expect(result).toMatchObject({
      ok: false,
      error: 'policy_actual_send_disabled',
      delivery: { status: 'blocked' },
    });
    expect(sender).not.toHaveBeenCalled();
    expect(recordAttempt).toHaveBeenLastCalledWith(
      intent.id,
      'blocked',
      expect.objectContaining({ error_code: 'policy_actual_send_disabled' }),
    );
  });
  it('creates one idempotent delivery for an eligible safe intent', async () => {
    const intent = seedIntent();
    const first = await enqueueAutoSendDelivery(intent.id);
    const second = await enqueueAutoSendDelivery(intent.id);
    expect(first).toMatchObject({ ok: true, created: true });
    expect(second).toMatchObject({ ok: true, created: false });
    expect(tables.booking_ops_communication_deliveries).toHaveLength(1);
  });

  it('does not send when the explicit scope is disabled', async () => {
    const intent = seedIntent();
    scopeDecision.mockResolvedValueOnce({ enabled: false, error: 'scope_disabled', scope: null, globalEmergencyStop: false });
    const queued = await enqueueAutoSendDelivery(intent.id);
    const sender = vi.fn();
    const result = await executeAutoSendDelivery(queued.ok ? queued.delivery.id : '', { sender });
    expect(result).toMatchObject({ ok: false, error: 'actual_send_disabled' });
    expect(sender).not.toHaveBeenCalled();
  });

  it('blocks legacy owner or pilot scopes for account-scoped residential execution', async () => {
    const intent = seedIntent({
      actor_type: 'cleaner',
      purpose: 'cleaner_task_assignment',
      metadata: { recipient_ref: 'staff-123', owner_id: 'owner-legacy' },
    });
    scopeDecision.mockResolvedValueOnce({
      enabled: true,
      scope: { ...enabledScope, scopeType: 'owner', scopeRef: 'owner-legacy' },
      globalEmergencyStop: false,
    });
    const queued = await enqueueAutoSendDelivery(intent.id, {}, { accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    const sender = vi.fn(async () => ({ ok: true }));
    const result = await executeAutoSendDelivery(
      queued.ok ? queued.delivery.id : '',
      { accountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sender },
    );
    expect(result).toMatchObject({ ok: false, error: 'scope_not_account_bound' });
    expect(sender).not.toHaveBeenCalled();
  });

  it('records a scope dry-run-only execution without calling a provider', async () => {
    const intent = seedIntent();
    scopeDecision.mockResolvedValueOnce({
      enabled: true,
      scope: { ...enabledScope, dryRunOnly: true },
      globalEmergencyStop: false,
    });
    const queued = await enqueueAutoSendDelivery(intent.id);
    const sender = vi.fn();
    const result = await executeAutoSendDelivery(queued.ok ? queued.delivery.id : '', { sender });
    expect(result).toMatchObject({ ok: true, dryRun: true, delivery: { status: 'dry_run' } });
    expect(sender).not.toHaveBeenCalled();
  });

  it('blocks every provider call while the global emergency stop is active', async () => {
    const intent = seedIntent();
    scopeDecision.mockResolvedValueOnce({ enabled: false, error: 'emergency_stop', scope: null, globalEmergencyStop: true });
    const queued = await enqueueAutoSendDelivery(intent.id);
    const sender = vi.fn();
    const result = await executeAutoSendDelivery(queued.ok ? queued.delivery.id : '', { sender });
    expect(result).toMatchObject({ ok: false, error: 'emergency_stop' });
    expect(sender).not.toHaveBeenCalled();
  });

  it('records a dry-run without calling a provider', async () => {
    const intent = seedIntent();
    const queued = await enqueueAutoSendDelivery(intent.id);
    const sender = vi.fn();
    const result = await executeAutoSendDelivery(queued.ok ? queued.delivery.id : '', { dryRun: true, sender });
    expect(result).toMatchObject({ ok: true, dryRun: true, delivery: { status: 'dry_run', attemptCount: 1 } });
    expect(sender).not.toHaveBeenCalled();
  });

  it('sends a safe message through the injected sender', async () => {
    const intent = seedIntent({ actor_type: 'cleaner', purpose: 'cleaner_task_assignment', metadata: { recipient_ref: 'staff-123' } });
    const queued = await enqueueAutoSendDelivery(intent.id);
    const sender = vi.fn(async () => ({ ok: true, providerMessageId: 'provider-1' }));
    const result = await executeAutoSendDelivery(queued.ok ? queued.delivery.id : '', { sender });
    expect(result).toMatchObject({ ok: true, delivery: { status: 'sent', providerMessageId: 'provider-1' } });
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['review_required', 'review_required'],
    ['blocked', 'blocked'],
    ['quiet_hours', 'quiet_hours'],
    ['rate_limited', 'rate_limited'],
  ])('does not send a %s decision', async (decision, error) => {
    const intent = seedIntent();
    policyDecision
      .mockResolvedValueOnce({ ...allowedDecision })
      .mockResolvedValueOnce({ ...allowedDecision, decision, allowed: false });
    const queued = await enqueueAutoSendDelivery(intent.id);
    const sender = vi.fn();
    const result = await executeAutoSendDelivery(queued.ok ? queued.delivery.id : '', { sender });
    expect(result).toMatchObject({ ok: false, error });
    expect(sender).not.toHaveBeenCalled();
  });

  it('keeps quota-unavailable retries blocked without calling a provider', async () => {
    const intent = seedIntent();
    const queued = await enqueueAutoSendDelivery(intent.id);
    policyDecision.mockResolvedValue({
      ...allowedDecision,
      decision: 'review_required',
      allowed: false,
      actual_send_enabled: false,
      rule_key: 'rate.booking_daily_unavailable',
    });
    const sender = vi.fn(async () => ({ ok: true }));
    const deliveryId = queued.ok ? queued.delivery.id : '';

    const first = await executeAutoSendDelivery(deliveryId, { sender });
    const retry = await executeAutoSendDelivery(deliveryId, { sender });

    expect(first).toMatchObject({
      ok: false,
      error: 'review_required',
      delivery: { status: 'blocked' },
      decision: { rule_key: 'rate.booking_daily_unavailable' },
    });
    expect(retry).toMatchObject({
      ok: false,
      error: 'review_required',
      delivery: { status: 'blocked' },
      decision: { rule_key: 'rate.booking_daily_unavailable' },
    });
    expect(sender).not.toHaveBeenCalled();
    expect(recordAttempt).toHaveBeenCalledTimes(2);
    expect(recordAttempt).toHaveBeenLastCalledWith(
      intent.id,
      'review_required',
      expect.objectContaining({ error_code: 'review_required' }),
    );
  });

  it('does not send an unsupported access-instruction type', async () => {
    const intent = seedIntent({ purpose: 'checkin_instructions' });
    const result = await enqueueAutoSendDelivery(intent.id);
    expect(result).toMatchObject({ ok: false, error: 'unsupported_message_type' });
  });

  it('does not bypass an operator review or block decision', async () => {
    const intent = seedIntent({
      metadata: {
        auto_send_eligible: true,
        auto_send_decision: {
          decision: 'review_required',
          rule_key: 'operator.review_required',
          safe_to_display_summary: 'Нужна ручная проверка.',
        },
      },
    });
    const result = await enqueueAutoSendDelivery(intent.id);
    expect(result).toMatchObject({ ok: false, error: 'review_required' });
  });

  it('does not send a duplicate completed delivery', async () => {
    const intent = seedIntent({ actor_type: 'cleaner', purpose: 'cleaner_task_assignment', metadata: { recipient_ref: 'staff-123' } });
    const queued = await enqueueAutoSendDelivery(intent.id);
    const sender = vi.fn(async () => ({ ok: true }));
    const id = queued.ok ? queued.delivery.id : '';
    await executeAutoSendDelivery(id, { sender });
    const duplicate = await executeAutoSendDelivery(id, { sender });
    expect(duplicate).toMatchObject({ ok: true, duplicate: true });
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it('holds an ambiguous provider failure and never automatically retries', async () => {
    const intent = seedIntent({ actor_type: 'cleaner', purpose: 'cleaner_task_assignment', metadata: { recipient_ref: 'staff-123' } });
    const queued = await enqueueAutoSendDelivery(intent.id);
    const id = queued.ok ? queued.delivery.id : '';
    const sender = vi.fn()
      .mockResolvedValueOnce({ ok: false, reason: 'provider_rejected' })
      .mockResolvedValueOnce({ ok: true });
    const failed = await executeAutoSendDelivery(id, { sender });
    const retried = await executeAutoSendDelivery(id, { sender });
    expect(failed).toMatchObject({ ok: false, error: 'quota_review_required', delivery: { status: 'sending', attemptCount: 1 } });
    expect(retried).toMatchObject({ ok: false, error: 'quota_review_required' });
    expect(sender).toHaveBeenCalledTimes(1);
    expect(quotaRows.get(id)?.state).toBe('uncertain');
  });

  it.each([
    ['booking', 1, null],
    ['guest', null, 1],
    ['both', 1, 1],
    ['zero', 0, 0],
  ])('two executor invocations respect last-slot %s in the RPC MODEL only', async (_kind, bookingLimit, guestLimit) => {
    bookingCap = bookingLimit;
    guestCap = guestLimit;
    const first = seedIntent();
    const second = seedIntent({ id: '55555555-5555-4555-8555-555555555555' });
    const a = await enqueueAutoSendDelivery(first.id);
    const b = await enqueueAutoSendDelivery(second.id);
    const sender = vi.fn(async () => ({ ok: true }));
    await Promise.all([
      executeAutoSendDelivery(a.ok ? a.delivery.id : '', { sender }),
      executeAutoSendDelivery(b.ok ? b.delivery.id : '', { sender }),
    ]);
    expect(sender).toHaveBeenCalledTimes(bookingLimit === 0 ? 0 : 1);
    expect(quotaRows.size).toBe(bookingLimit === 0 ? 0 : 1);
  });

  it('same-delivery race has one provider call and one durable claim in the RPC MODEL', async () => {
    const intent = seedIntent();
    const queued = await enqueueAutoSendDelivery(intent.id);
    const id = queued.ok ? queued.delivery.id : '';
    const sender = vi.fn(async () => ({ ok: true }));
    await Promise.all([executeAutoSendDelivery(id, { sender }), executeAutoSendDelivery(id, { sender })]);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(quotaRows.size).toBe(1);
  });

  it.each(['missing-rpc', 'timeout', 'forged-receipt'])('fails closed before sender on %s', async kind => {
    const intent = seedIntent();
    const queued = await enqueueAutoSendDelivery(intent.id);
    if (kind === 'timeout') quotaRpc.mockRejectedValueOnce(new Error('timeout'));
    else quotaRpc.mockResolvedValueOnce(kind === 'missing-rpc'
      ? { data: null, error: { code: 'PGRST202' } }
      : { data: { allowed: true, phase: 'reserve', reservation_id: 'caller-proof' }, error: null });
    const sender = vi.fn();
    const result = await executeAutoSendDelivery(queued.ok ? queued.delivery.id : '', { sender });
    expect(result).toMatchObject({ ok: false, error: 'quota_review_required' });
    expect(sender).not.toHaveBeenCalled();
  });

  it('denies malformed tenant before RPC despite allowed policy', async () => {
    const intent = seedIntent();
    const queued = await enqueueAutoSendDelivery(intent.id);
    tables.booking_ops_communication_deliveries[0].account_id = 'caller-account';
    const sender = vi.fn();
    await executeAutoSendDelivery(queued.ok ? queued.delivery.id : '', { sender });
    expect(sender).not.toHaveBeenCalled();
    expect(quotaRpc).not.toHaveBeenCalled();
  });

  it('dry run makes zero quota calls and zero sends', async () => {
    const intent = seedIntent();
    const queued = await enqueueAutoSendDelivery(intent.id);
    const sender = vi.fn();
    await executeAutoSendDelivery(queued.ok ? queued.delivery.id : '', { dryRun: true, sender });
    expect(quotaRpc).not.toHaveBeenCalled();
    expect(sender).not.toHaveBeenCalled();
  });

  it('revocation after reserve holds capacity before any provider call', async () => {
    const intent = seedIntent();
    const queued = await enqueueAutoSendDelivery(intent.id);
    scopeDecision.mockResolvedValueOnce({ enabled: true, scope: { ...enabledScope } })
      .mockResolvedValueOnce({ enabled: false, error: 'emergency_stop', scope: null });
    const sender = vi.fn();
    const id = queued.ok ? queued.delivery.id : '';
    await executeAutoSendDelivery(id, { sender });
    expect(sender).not.toHaveBeenCalled();
    expect(quotaRows.get(id)?.state).toBe('held');
  });

  it('lost dispatch response never sends or recycles held capacity', async () => {
    const intent = seedIntent();
    const queued = await enqueueAutoSendDelivery(intent.id);
    const id = queued.ok ? queued.delivery.id : '';
    const original = quotaRpc.getMockImplementation()!;
    quotaRpc.mockImplementationOnce(original).mockImplementationOnce(async (_name, args) => {
      await original(_name, args);
      throw new Error('dispatch response lost');
    });
    const sender = vi.fn();
    await executeAutoSendDelivery(id, { sender });
    await executeAutoSendDelivery(id, { sender });
    expect(sender).not.toHaveBeenCalled();
    expect(quotaRows.get(id)?.state).toBe('dispatching');
  });

  it('provider acceptance followed by persistence loss is held and not resent', async () => {
    const intent = seedIntent();
    const queued = await enqueueAutoSendDelivery(intent.id);
    const id = queued.ok ? queued.delivery.id : '';
    const original = quotaRpc.getMockImplementation()!;
    quotaRpc.mockImplementationOnce(original).mockImplementationOnce(original)
      .mockRejectedValueOnce(new Error('persistence unavailable'));
    const sender = vi.fn(async () => ({ ok: true, providerMessageId: 'synthetic-message' }));
    await executeAutoSendDelivery(id, { sender });
    await executeAutoSendDelivery(id, { sender });
    expect(sender).toHaveBeenCalledTimes(1);
    expect(quotaRows.get(id)?.state).toBe('dispatching');
  });

  it('provider timeout remains uncertain and disables voice follow-up', async () => {
    const intent = seedIntent({ metadata: { lifecycle_event_type: 'arrival', communication_mode: 'voice' } });
    const queued = await enqueueAutoSendDelivery(intent.id);
    const id = queued.ok ? queued.delivery.id : '';
    const sender = vi.fn(async () => { throw new Error('timeout'); });
    const voiceSender = vi.fn();
    await executeAutoSendDelivery(id, { sender, voiceSender });
    await executeAutoSendDelivery(id, { sender, voiceSender });
    expect(sender).toHaveBeenCalledTimes(1);
    expect(voiceSender).not.toHaveBeenCalled();
    expect(quotaRows.get(id)?.state).toBe('uncertain');
  });

  it('successful text cannot bypass quota with an unreserved voice copy', async () => {
    const intent = seedIntent({ metadata: { lifecycle_event_type: 'arrival', communication_mode: 'voice' } });
    const queued = await enqueueAutoSendDelivery(intent.id);
    const sender = vi.fn(async () => ({ ok: true }));
    const voiceSender = vi.fn();
    await executeAutoSendDelivery(queued.ok ? queued.delivery.id : '', { sender, voiceSender });
    expect(sender).toHaveBeenCalledTimes(1);
    expect(voiceSender).not.toHaveBeenCalled();
  });

  it('rejects production caller injected send/scope seams', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const sender = vi.fn();
    try {
      expect(await executeAutoSendDelivery('not-read', { sender }))
        .toMatchObject({ ok: false, error: 'test_seam_forbidden' });
      expect(sender).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });

  it.each([[2, 2], [null, null]])('admits exact cap or unlimited (%s/%s) in RPC MODEL', async (bookingLimit, guestLimit) => {
    bookingCap = bookingLimit;
    guestCap = guestLimit;
    const sender = vi.fn(async () => ({ ok: true }));
    for (const id of ['55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666']) {
      const intent = seedIntent({ id });
      const queued = await enqueueAutoSendDelivery(intent.id);
      await executeAutoSendDelivery(queued.ok ? queued.delivery.id : '', { sender });
    }
    expect(sender).toHaveBeenCalledTimes(2);
  });

  it('lost reserve response retains the committed claim without sending', async () => {
    const intent = seedIntent();
    const queued = await enqueueAutoSendDelivery(intent.id);
    const id = queued.ok ? queued.delivery.id : '';
    const original = quotaRpc.getMockImplementation()!;
    quotaRpc.mockImplementationOnce(async (name, args) => {
      await original(name, args);
      throw new Error('response lost after reserve commit');
    });
    const sender = vi.fn();
    await executeAutoSendDelivery(id, { sender });
    await executeAutoSendDelivery(id, { sender });
    expect(sender).not.toHaveBeenCalled();
    expect(quotaRows.get(id)?.state).toBe('held');
    expect(tables.booking_ops_communication_deliveries[0].status).toBe('sending');
  });

  it('rejects a changed recipient and never supplies claimed counts to RPC', async () => {
    const intent = seedIntent();
    const queued = await enqueueAutoSendDelivery(intent.id);
    tables.booking_ops_communication_deliveries[0].recipient_ref = 'different-recipient';
    const sender = vi.fn();
    await executeAutoSendDelivery(queued.ok ? queued.delivery.id : '', { sender });
    expect(sender).not.toHaveBeenCalled();
    expect(quotaRpc).not.toHaveBeenCalled();
    tables.booking_ops_communication_deliveries[0].recipient_ref = '123456';
    await executeAutoSendDelivery(queued.ok ? queued.delivery.id : '', { sender: vi.fn(async () => ({ ok: true })) });
    for (const [, args] of quotaRpc.mock.calls) {
      expect(Object.keys(args).some(key => /(?:count|limit|cap)$/.test(key))).toBe(false);
    }
  });

  it('keeps all new API surfaces protected', async () => {
    const queue = await import('@/app/api/dashboard/booking-ops/communications/auto-send/queue/route');
    const execute = await import('@/app/api/dashboard/booking-ops/communications/auto-send/execute/route');
    const dryRun = await import('@/app/api/dashboard/booking-ops/communications/auto-send/dry-run/route');
    const individual = await import('@/app/api/dashboard/booking-ops/[id]/communications/[communicationId]/auto-send/execute/route');
    const status = await import('@/app/api/dashboard/booking-ops/communications/auto-send/scope/status/route');
    const enable = await import('@/app/api/dashboard/booking-ops/communications/auto-send/scope/enable/route');
    const disable = await import('@/app/api/dashboard/booking-ops/communications/auto-send/scope/disable/route');
    const emergency = await import('@/app/api/dashboard/booking-ops/communications/auto-send/emergency-stop/route');
    const responses = await Promise.all([
      queue.GET(new Request('https://asi.test/api/dashboard/booking-ops/communications/auto-send/queue')),
      execute.POST(new Request('https://asi.test/api/dashboard/booking-ops/communications/auto-send/execute', { method: 'POST', body: '{}' })),
      dryRun.POST(new Request('https://asi.test/api/dashboard/booking-ops/communications/auto-send/dry-run', { method: 'POST', body: '{}' })),
      individual.POST(new Request('https://asi.test/api/dashboard/booking-ops/record/communications/33333333-3333-4333-8333-333333333333/auto-send/execute', { method: 'POST', body: '{}' }), {
        params: { id: 'record', communicationId: '33333333-3333-4333-8333-333333333333' },
      }),
      status.GET(),
      enable.POST(new Request('https://asi.test/api/dashboard/booking-ops/communications/auto-send/scope/enable', { method: 'POST', body: '{}' })),
      disable.POST(new Request('https://asi.test/api/dashboard/booking-ops/communications/auto-send/scope/disable', { method: 'POST', body: '{}' })),
      emergency.POST(new Request('https://asi.test/api/dashboard/booking-ops/communications/auto-send/emergency-stop', { method: 'POST', body: '{}' })),
    ]);
    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401, 401, 401, 401, 401]);
  });

  it('requires an explicit accountId for the internal scheduled runner', async () => {
    vi.stubEnv('BOOKING_OPS_AUTO_SEND_RUNNER_SECRET', 'runner-secret');
    const internal = await import('@/app/api/internal/booking-ops/communications/auto-send/run/route');
    const response = await internal.POST(new Request(
      'https://asi.test/api/internal/booking-ops/communications/auto-send/run',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer runner-secret',
          'Content-Type': 'application/json',
        },
        body: '{}',
      },
    ));
    expect(response.status).toBe(400);
    vi.unstubAllEnvs();
  });

  it('requires a valid internal runner secret', async () => {
    vi.stubEnv('BOOKING_OPS_AUTO_SEND_RUNNER_SECRET', 'runner-secret');
    const internal = await import('@/app/api/internal/booking-ops/communications/auto-send/run/route');
    const missing = await internal.POST(new Request('https://asi.test/api/internal/booking-ops/communications/auto-send/run', { method: 'POST' }));
    const invalid = await internal.POST(new Request('https://asi.test/api/internal/booking-ops/communications/auto-send/run', {
      method: 'POST', headers: { Authorization: 'Bearer wrong-secret' },
    }));
    expect([missing.status, invalid.status]).toEqual([401, 401]);
    vi.unstubAllEnvs();
  });
});
