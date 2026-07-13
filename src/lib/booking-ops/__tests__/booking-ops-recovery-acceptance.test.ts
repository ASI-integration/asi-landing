import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const state = {
    records: [] as Row[],
    events: [] as Row[],
    autopilotStates: [] as Row[],
    lifecycleStates: [] as Row[],
    tasks: [] as Row[],
    decisions: [] as Row[],
    audits: [] as Row[],
    alerts: [] as Row[],
    failAutopilotWriteOnce: false,
  };

  class Query {
    private filters: Array<(row: Row) => boolean> = [];
    private mutation: 'insert' | 'update' | 'upsert' | null = null;
    private value: Row | null = null;
    private max = Number.POSITIVE_INFINITY;
    constructor(private table: string) {}
    select() { return this; }
    insert(value: Row) { this.mutation = 'insert'; this.value = value; return this; }
    update(value: Row) { this.mutation = 'update'; this.value = value; return this; }
    upsert(value: Row) { this.mutation = 'upsert'; this.value = value; return this; }
    eq(column: string, value: unknown) { this.filters.push((row) => row[column] === value); return this; }
    neq(column: string, value: unknown) { this.filters.push((row) => row[column] !== value); return this; }
    in(column: string, values: unknown[]) { this.filters.push((row) => values.includes(row[column])); return this; }
    is(column: string, value: unknown) { this.filters.push((row) => value === null ? row[column] == null : row[column] === value); return this; }
    not(column: string, operator: string, value: unknown) {
      if (operator === 'is' && value === null) this.filters.push((row) => row[column] != null);
      return this;
    }
    order() { return this; }
    limit(value: number) { this.max = value; return this; }
    private rows() {
      if (this.table === 'booking_ops_records') return state.records;
      if (this.table === 'booking_ops_domain_events') return state.events;
      if (this.table === 'booking_ops_autopilot_states') return state.autopilotStates;
      if (this.table === 'booking_ops_lifecycle_states') return state.lifecycleStates;
      if (this.table === 'booking_ops_worker_tasks') return state.tasks;
      if (this.table === 'booking_ops_lifecycle_decisions') return state.decisions;
      if (this.table === 'booking_ops_lifecycle_events') return state.audits;
      if (this.table === 'booking_ops_alerts') return state.alerts;
      return [];
    }
    private async execute() {
      const rows = this.rows();
      if (this.mutation === 'insert' && this.value) {
        if (rows.some((row) => row.id === this.value?.id)) return { data: null, error: { code: '23505', message: 'duplicate' } };
        rows.push({ ...this.value });
        return { data: { ...this.value }, error: null };
      }
      if (this.mutation === 'update' && this.value) {
        const matches = rows.filter((row) => this.filters.every((filter) => filter(row)));
        for (const row of matches) Object.assign(row, this.value);
        return { data: matches.map((row) => ({ ...row })), error: null };
      }
      if (this.mutation === 'upsert' && this.value) {
        if (this.table === 'booking_ops_autopilot_states' && state.failAutopilotWriteOnce) {
          state.failAutopilotWriteOnce = false;
          return { data: null, error: { message: 'transient_state_write_failure' } };
        }
        const key = this.value.booking_id ? 'booking_id' : 'id';
        const existing = rows.find((row) => row[key] === this.value?.[key]);
        if (existing) Object.assign(existing, this.value);
        else rows.push({ ...this.value });
        return { data: existing ? { ...existing } : { ...this.value }, error: null };
      }
      return { data: rows.filter((row) => this.filters.every((filter) => filter(row))).slice(0, this.max).map((row) => ({ ...row })), error: null };
    }
    async single() {
      const result = await this.execute();
      const data = Array.isArray(result.data) ? result.data[0] ?? null : result.data;
      return { ...result, data };
    }
    async maybeSingle() { return this.single(); }
    then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
      return this.execute().then(resolve, reject);
    }
  }
  return { state, supabase: { from: (table: string) => new Query(table) } };
});

vi.mock('@/lib/supabase', () => ({ supabase: database.supabase }));

import {
  recordAndProcessBookingEvent,
  recoverUnprocessedBookingEvents,
} from '../lifecycle-autopilot-service';
import { reconcileBookingLifecycle } from '../lifecycle-reconciliation';
import { acknowledgeOperatorAlert, reconcileOperatorAlertConditions } from '../operator-alerts';

const domainEvent = {
  id: 'completion-event', booking_id: 'booking-1', object_id: 'property-1', event_type: 'cleaner.task_completed',
  actor_type: 'system', actor_id: null, payload: {}, source: 'acceptance', correlation_id: 'reconcile-run',
  causation_id: null, created_at: '2026-07-13T08:00:00.000Z', processed_at: '2026-07-13T08:00:01.000Z', processing_error: null,
};

beforeEach(() => {
  database.state.records = [{ id: 'booking-1', account_id: 'account-a', property_id: 'property-1', reservation_metadata: { acceptance_safe: true } }];
  database.state.events = [];
  database.state.autopilotStates = [];
  database.state.lifecycleStates = [];
  database.state.tasks = [];
  database.state.decisions = [];
  database.state.audits = [];
  database.state.alerts = [];
  database.state.failAutopilotWriteOnce = false;
});

function staleLifecycleFixture() {
  database.state.events = [{ ...domainEvent }];
  database.state.lifecycleStates = [{
    booking_id: 'booking-1', property_id: null, current_stage: 'guest_intake', status: 'waiting_guest',
    blocker_reasons: ['guest_data'], next_action: 'collect', final_checkin_draft_allowed: false,
  }];
  database.state.tasks = [{
    id: 'cleaner-task', booking_id: 'booking-1', task_key: 'booking-1:cleaner', assigned_role: 'cleaner',
    status: 'pending', completion_event_id: null,
  }];
}

describe('Booking Ops retry and reconciliation acceptance', () => {
  it('retains recoverable event failure details and does not silently advance state', async () => {
    database.state.failAutopilotWriteOnce = true;
    await expect(recordAndProcessBookingEvent({
      id: 'failed-event', bookingId: 'booking-1', objectId: 'property-1', type: 'alert.acknowledged',
      actorType: 'system', source: 'acceptance', correlationId: 'retry-run',
    })).rejects.toThrow('transient_state_write_failure');

    expect(database.state.events[0]).toMatchObject({ id: 'failed-event', processing_error: 'transient_state_write_failure' });
    expect(database.state.events[0].processed_at).toBeUndefined();
    expect(database.state.autopilotStates).toHaveLength(0);
    expect(database.state.decisions).toHaveLength(0);
  });

  it('retries a failed unprocessed event once and repeated recovery creates no duplicate decision', async () => {
    database.state.failAutopilotWriteOnce = true;
    await expect(recordAndProcessBookingEvent({
      id: 'failed-event', bookingId: 'booking-1', objectId: 'property-1', type: 'alert.acknowledged',
      actorType: 'system', source: 'acceptance', correlationId: 'retry-run',
    })).rejects.toThrow();

    const recovered = await recoverUnprocessedBookingEvents();
    const repeated = await recoverUnprocessedBookingEvents();
    expect(recovered).toEqual({ evaluated: 1, processed: 1, errors: [] });
    expect(repeated).toEqual({ evaluated: 0, processed: 0, errors: [] });
    expect(database.state.events[0]).toMatchObject({ processed_at: expect.any(String), processing_error: null });
    expect(database.state.decisions).toHaveLength(1);
    expect(database.state.lifecycleStates[0]).toMatchObject({ current_stage: 'booking_received' });
  });

  it('reports stale projection and task repairs in dry-run without mutations or external actions', async () => {
    staleLifecycleFixture();
    const before = JSON.stringify(database.state);
    const result = await reconcileBookingLifecycle({ bookingId: 'booking-1', accountId: 'account-a', actorId: 'operator-1' });

    expect(result).toMatchObject({ dryRun: true, changed: true, projectionChanged: true, taskRepairs: 1 });
    expect(JSON.stringify(database.state)).toBe(before);
  });

  it('repairs stale state idempotently and rejects reconciliation from another account', async () => {
    staleLifecycleFixture();
    await expect(reconcileBookingLifecycle({ bookingId: 'booking-1', accountId: 'account-b', actorId: 'operator-b', dryRun: false })).rejects.toThrow('reservation_account_mismatch');
    const repaired = await reconcileBookingLifecycle({ bookingId: 'booking-1', accountId: 'account-a', actorId: 'operator-1', dryRun: false });
    const repeated = await reconcileBookingLifecycle({ bookingId: 'booking-1', accountId: 'account-a', actorId: 'operator-1', dryRun: false });

    expect(repaired).toMatchObject({ changed: true, taskRepairs: 1 });
    expect(database.state.lifecycleStates[0]).toMatchObject({ property_id: 'property-1', current_stage: 'cleaning_completed' });
    expect(database.state.tasks[0]).toMatchObject({ status: 'completed', completion_event_id: 'completion-event' });
    expect(repeated).toMatchObject({ changed: false, taskRepairs: 0 });
    expect(database.state.audits).toHaveLength(1);
  });

  it('preserves resolved alert history and creates a new incident when the condition recurs', async () => {
    const condition = {
      code: 'DEPOSIT_NOT_RECEIVED', incidentFamily: 'DEPOSIT', sourceDomain: 'payment', sourceGate: 'deposit_received',
      severity: 'warning' as const, title: 'Deposit missing', description: 'Deposit is required',
      recommendedAction: 'Confirm deposit', deadlineAt: null, metadata: { gateStatus: 'blocked' },
    };
    const input = {
      accountId: 'account-a', bookingId: 'booking-1', propertyId: 'property-1', managedSourceDomains: ['payment'],
    };
    await reconcileOperatorAlertConditions({ ...input, conditions: [condition], now: '2026-07-13T09:00:00.000Z' });
    const firstId = String(database.state.alerts[0].id);
    await acknowledgeOperatorAlert('account-a', firstId, 'operator-1');
    await reconcileOperatorAlertConditions({ ...input, conditions: [], now: '2026-07-13T09:10:00.000Z' });
    await reconcileOperatorAlertConditions({ ...input, conditions: [condition], now: '2026-07-13T09:20:00.000Z' });

    expect(database.state.alerts).toHaveLength(2);
    expect(database.state.alerts[0]).toMatchObject({
      id: firstId, status: 'resolved', acknowledged_by: 'operator-1', resolution_reason: 'underlying_condition_cleared',
    });
    expect(database.state.alerts[1]).toMatchObject({ status: 'open', dedupe_key: database.state.alerts[0].dedupe_key });
  });
});
