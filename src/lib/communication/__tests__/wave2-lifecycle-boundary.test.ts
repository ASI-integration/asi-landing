import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuestLifecycleEvent, GuestLifecycleReservationContext, GuestLifecyclePlan } from '../guest-lifecycle';
type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, failure: '', account: 'a',
  handoff: vi.fn((_input: Record<string, unknown>) => ({ reviewId: 'review-1' })) }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/booking-ops/repository', () => ({
  getBookingOpsByBookingId: async () => ({ id: 'r', accountId: state.account, propertyId: 'p', guestEmail: null }),
  getBookingOpsRecord: async () => null,
}));
vi.mock('../operator-review', () => ({ listEscalationReviews: () => [] }));
vi.mock('../handoff-lock', () => ({ requestOperatorHandoff: state.handoff }));
vi.mock('../guest-long-term-memory', () => ({
  resolveGuestMemoryAccountId: async () => state.account || null,
  loadGuestLongTermMemory: async () => ({}), buildRelevantGuestMemoryContext: () => null,
  recordGuestOperationalEvent: vi.fn(),
}));
class Query {
  filters: Array<(row: Row) => boolean> = []; values: Row | null = null; mode = 'select';
  constructor(readonly table: string) {}
  select() { return this; } limit() { return this; } order() { return this; }
  eq(key: string, value: unknown) {
    this.filters.push((row) => key.startsWith('metadata->>')
      ? (row.metadata as Row)?.[key.slice(11)] === value : row[key] === value); return this;
  }
  in(key: string, values: unknown[]) { this.filters.push((row) => values.includes(row[key])); return this; }
  insert(values: Row) { this.mode = 'insert'; this.values = values; return this; }
  update(values: Row) { this.mode = 'update'; this.values = values; return this; }
  run() {
    if (state.failure === this.table) return { error: { message: 'secret-error' }, data: null };
    const rows = state.tables[this.table] ?? [];
    let data = rows.filter((row) => this.filters.every((filter) => filter(row)));
    if (this.mode === 'insert') { rows.push(this.values!); data = [this.values!]; }
    if (this.mode === 'update') data.forEach((row) => Object.assign(row, this.values));
    return { data, error: null };
  }
  async maybeSingle() { const result = this.run(); return { ...result, data: result.data?.[0] ?? null }; }
  then(resolve: (value: unknown) => unknown) { return Promise.resolve(this.run()).then(resolve); }
}
const db = { from: (table: string) => new Query(table) };
import { createGuestLifecycleRuntimePort, listGuestLifecycleVisibility } from '../guest-lifecycle-runtime';
const event: GuestLifecycleEvent = { eventType: 'reservation.created', reservationId: 'booking', propertyId: 'p',
  guestId: 'g', occurredAt: new Date().toISOString(), source: 'booking_ops', sourceEventId: 'evt-1' };
const context = { accountId: 'a', bookingOpsRecordId: 'r', propertyId: 'p', guestId: 'g',
  reservationId: 'booking', channel: 'telegram', targetId: '123', identityVerified: true } as GuestLifecycleReservationContext;
const plan = { action: 'send', purpose: 'neutral_booking_acknowledgement',
  text: 'Door code: SECRET. Deposit returned!', stage: 'reservation', safeSummary: 'Safe',
  language: 'ru', communicationMode: 'text', urgent: false } as GuestLifecyclePlan;
beforeEach(() => {
  state.failure = ''; state.account = 'a'; state.handoff.mockClear();
  state.tables = {
    booking_ops_records: [{ id: 'r', account_id: 'a', property_id: 'p', booking_id: 'booking',
      ops_status: 'created', updated_at: new Date().toISOString() }],
    properties: [{ id: 'p', account_id: 'a' }],
    tg_guest_reservations: [{ id: 'booking', booking_id: 'booking', property_id: 'p', guest_id: 'g', chat_id: '123' }],
    object_knowledge_entries: [], guest_lifecycle_events: [], booking_ops_communication_intents: [],
  };
});
async function deliver(overrides: Partial<GuestLifecycleReservationContext> = {}) {
  return createGuestLifecycleRuntimePort({ db }).deliver({
    event, context: { ...context, ...overrides }, plan, idempotencyKey: 'key',
  });
}
describe('proactive lifecycle uses shared knowledge boundary before persistence', () => {
  it('persists only verified draft text, requests a scoped operator and never auto-sends', async () => {
    const result = await deliver();
    expect(result).toMatchObject({ status: 'blocked', reason: 'knowledge_operator_review_required' });
    expect(state.tables.booking_ops_communication_intents).toHaveLength(1);
    expect(JSON.stringify(state.tables.booking_ops_communication_intents)).not.toContain('SECRET');
    expect(state.handoff).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'a', propertyId: 'p',
      suggestedReply: expect.stringContaining('Бронь создана') }));
  });
  it.each([{ accountId: 'b' }, { accountId: undefined }, { targetId: 'foreign' },
    { bookingOpsRecordId: 'foreign' }])('rejects foreign/stale context %j without any draft/handoff', async (override) => {
      expect((await deliver(override)).status).toBe('blocked');
      expect(state.tables.booking_ops_communication_intents).toHaveLength(0);
      expect(state.handoff).not.toHaveBeenCalled();
    });
  it.each(['properties', 'booking_ops_records'])('fails closed when %s is unreadable', async (table) => {
    state.failure = table; await deliver();
    expect(state.tables.booking_ops_communication_intents).toHaveLength(0);
    expect(state.handoff).not.toHaveBeenCalled();
  });
  it('stale facts become a review placeholder, not the old generated assertion', async () => {
    state.tables.booking_ops_records[0].updated_at = '2000-01-01T00:00:00Z';
    await deliver();
    const row = state.tables.booking_ops_communication_intents[0];
    expect(row.status).toBe('waiting_for_external_input');
    expect(JSON.stringify(row)).not.toContain('SECRET');
    expect(state.handoff.mock.calls[0]?.[0]).toMatchObject({ suggestedReply: undefined });
  });
  it('does not create a handoff after failed draft persistence', async () => {
    state.failure = 'booking_ops_communication_intents'; await deliver();
    expect(state.handoff).not.toHaveBeenCalled();
  });
});
describe('lifecycle tenant visibility', () => {
  it('does not expose a foreign booking through an owned property id', async () => {
    state.tables.guest_lifecycle_events = [{ id: 'e', property_id: 'p', booking_ops_record_id: 'foreign-r', reservation_id: 'foreign' }];
    state.tables.booking_ops_records.push({ id: 'foreign-r', property_id: 'p', account_id: 'b' });
    expect(await listGuestLifecycleVisibility({ accountId: 'a', db })).toEqual({ ok: true, items: [] });
  });
  it('does not turn ownership read errors into an empty healthy panel', async () => {
    state.failure = 'properties';
    expect(await listGuestLifecycleVisibility({ accountId: 'a', db })).toMatchObject({ ok: false, items: [] });
  });
});

describe('lifecycle identity ambiguity and replay', () => {
  it('rejects ambiguous reservation bindings before creating a draft', async () => {
    state.tables.tg_guest_reservations.push({ ...state.tables.tg_guest_reservations[0], chat_id: '456' });
    await deliver();
    expect(state.tables.booking_ops_communication_intents).toHaveLength(0);
    expect(state.handoff).not.toHaveBeenCalled();
  });
  it('cannot recover a recipient from a global guest-id-only identity', async () => {
    state.tables.tg_guest_reservations[0].chat_id = null;
    state.tables.tg_guest_identities = [{ guest_id: 'g', telegram_chat_id: 'foreign' }];
    await deliver();
    expect(state.tables.booking_ops_communication_intents).toHaveLength(0);
  });
  it('refreshes a legacy draft on retry without duplicating or trusting its content', async () => {
    await deliver();
    state.tables.booking_ops_communication_intents[0].message_text = 'SECRET LEGACY ACCESS';
    await deliver();
    expect(state.tables.booking_ops_communication_intents).toHaveLength(1);
    expect(JSON.stringify(state.tables.booking_ops_communication_intents)).not.toContain('SECRET');
  });
  it('rejects a changed recipient on the explicit operator path', async () => {
    const port = createGuestLifecycleRuntimePort({ db });
    await expect(port.requestOperator({ event, context: { ...context, targetId: 'foreign' },
      plan, idempotencyKey: 'key' })).rejects.toThrow('lifecycle_owner_unavailable');
    expect(state.handoff).not.toHaveBeenCalled();
  });
});
