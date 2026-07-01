import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;
const tables: Record<string, Row[]> = {
  booking_ops_communication_intents: [],
  booking_ops_communication_deliveries: [],
};

class Query {
  private filters: Array<(row: Row) => boolean> = [];
  private limitValue: number | null = null;
  private mode: 'select' | 'insert' | 'update' = 'select';
  private values: Row | Row[] | null = null;

  constructor(private table: string) {}
  select() { return this; }
  eq(field: string, value: unknown) { this.filters.push((row) => row[field] === value); return this; }
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

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (table: string) => new Query(table) },
}));

vi.mock('@/lib/booking-ops/repository', () => ({
  getBookingOpsRecord: vi.fn(async () => ({
    id: '11111111-1111-4111-8111-111111111111',
    bookingId: 'booking-1',
    propertyId: 'property-1',
    guestTelegram: '123456',
    guestEmail: 'guest@example.test',
    guestIntake: null,
  })),
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

import {
  enqueueAutoSendDelivery,
  executeAutoSendDelivery,
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
  tables.booking_ops_communication_intents = [];
  tables.booking_ops_communication_deliveries = [];
  policyDecision.mockReset();
  policyDecision.mockResolvedValue({ ...allowedDecision });
  recordAttempt.mockClear();
});

describe('controlled actual auto-send executor', () => {
  it('creates one idempotent delivery for an eligible safe intent', async () => {
    const intent = seedIntent();
    const first = await enqueueAutoSendDelivery(intent.id);
    const second = await enqueueAutoSendDelivery(intent.id);
    expect(first).toMatchObject({ ok: true, created: true });
    expect(second).toMatchObject({ ok: true, created: false });
    expect(tables.booking_ops_communication_deliveries).toHaveLength(1);
  });

  it('does not send when actual sending is disabled', async () => {
    const intent = seedIntent();
    policyDecision
      .mockResolvedValueOnce({ ...allowedDecision, actual_send_enabled: false })
      .mockResolvedValueOnce({ ...allowedDecision, actual_send_enabled: false });
    const queued = await enqueueAutoSendDelivery(intent.id);
    const sender = vi.fn();
    const result = await executeAutoSendDelivery(queued.ok ? queued.delivery.id : '', { sender });
    expect(result).toMatchObject({ ok: false, error: 'actual_send_disabled' });
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
    const intent = seedIntent();
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
    const intent = seedIntent();
    const queued = await enqueueAutoSendDelivery(intent.id);
    const sender = vi.fn(async () => ({ ok: true }));
    const id = queued.ok ? queued.delivery.id : '';
    await executeAutoSendDelivery(id, { sender });
    const duplicate = await executeAutoSendDelivery(id, { sender });
    expect(duplicate).toMatchObject({ ok: true, duplicate: true });
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it('records failure and retries the same safe delivery', async () => {
    const intent = seedIntent();
    const queued = await enqueueAutoSendDelivery(intent.id);
    const id = queued.ok ? queued.delivery.id : '';
    const sender = vi.fn()
      .mockResolvedValueOnce({ ok: false, reason: 'provider_rejected' })
      .mockResolvedValueOnce({ ok: true });
    const failed = await executeAutoSendDelivery(id, { sender });
    const retried = await executeAutoSendDelivery(id, { sender });
    expect(failed).toMatchObject({ ok: false, delivery: { status: 'failed', attemptCount: 1 } });
    expect(retried).toMatchObject({ ok: true, delivery: { status: 'sent', attemptCount: 2 } });
  });

  it('keeps all new API surfaces protected', async () => {
    const queue = await import('@/app/api/dashboard/booking-ops/communications/auto-send/queue/route');
    const execute = await import('@/app/api/dashboard/booking-ops/communications/auto-send/execute/route');
    const dryRun = await import('@/app/api/dashboard/booking-ops/communications/auto-send/dry-run/route');
    const individual = await import('@/app/api/dashboard/booking-ops/[id]/communications/[communicationId]/auto-send/execute/route');
    const responses = await Promise.all([
      queue.GET(new Request('https://asi.test/api/dashboard/booking-ops/communications/auto-send/queue')),
      execute.POST(new Request('https://asi.test/api/dashboard/booking-ops/communications/auto-send/execute', { method: 'POST', body: '{}' })),
      dryRun.POST(new Request('https://asi.test/api/dashboard/booking-ops/communications/auto-send/dry-run', { method: 'POST', body: '{}' })),
      individual.POST(new Request('https://asi.test/api/dashboard/booking-ops/record/communications/33333333-3333-4333-8333-333333333333/auto-send/execute', { method: 'POST', body: '{}' }), {
        params: { id: 'record', communicationId: '33333333-3333-4333-8333-333333333333' },
      }),
    ]);
    expect(responses.map((response) => response.status)).toEqual([401, 401, 401, 401]);
  });
});
