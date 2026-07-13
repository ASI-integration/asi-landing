import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const state = {
    bookings: [] as Row[],
    alerts: [] as Row[],
    duplicateRaceRow: null as Row | null,
  };

  class Query {
    private operation: 'select' | 'insert' | 'update' = 'select';
    private payload: Row | null = null;
    private filters: Array<(row: Row) => boolean> = [];
    private maxRows: number | null = null;

    constructor(private readonly table: string) {}
    select() { return this; }
    insert(payload: Row) { this.operation = 'insert'; this.payload = payload; return this; }
    update(payload: Row) { this.operation = 'update'; this.payload = payload; return this; }
    eq(column: string, value: unknown) { this.filters.push((row) => row[column] === value); return this; }
    in(column: string, values: unknown[]) { this.filters.push((row) => values.includes(row[column])); return this; }
    gte(column: string, value: unknown) { this.filters.push((row) => String(row[column] ?? '') >= String(value)); return this; }
    lte(column: string, value: unknown) { this.filters.push((row) => String(row[column] ?? '') <= String(value)); return this; }
    order() { return this; }
    limit(value: number) { this.maxRows = value; return this; }
    maybeSingle() { return this.execute(true); }
    single() { return this.execute(true); }
    then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
      return this.execute(false).then(resolve, reject);
    }

    private rows() { return this.table === 'booking_ops_records' ? state.bookings : state.alerts; }
    private matching() {
      const rows = this.rows().filter((row) => this.filters.every((filter) => filter(row)));
      return this.maxRows === null ? rows : rows.slice(0, this.maxRows);
    }
    private async execute(single: boolean) {
      if (this.operation === 'select') {
        const rows = this.matching();
        return { data: single ? rows[0] ?? null : rows.map((row) => ({ ...row })), error: null };
      }
      if (this.operation === 'update') {
        const rows = this.matching();
        for (const row of rows) Object.assign(row, this.payload);
        return { data: single ? (rows[0] ? { ...rows[0] } : null) : rows.map((row) => ({ ...row })), error: null };
      }
      if (this.table === 'booking_ops_alerts' && state.duplicateRaceRow) {
        state.alerts.push({ ...state.duplicateRaceRow });
        state.duplicateRaceRow = null;
        return { data: null, error: { code: '23505', message: 'duplicate key' } };
      }
      const row = { ...this.payload };
      this.rows().push(row);
      return { data: single ? { ...row } : [{ ...row }], error: null };
    }
  }

  return {
    state,
    supabase: { from: (table: string) => new Query(table) },
  };
});

vi.mock('@/lib/supabase', () => ({ supabase: database.supabase }));
vi.mock('../events', () => ({ recordBookingOpsEvent: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/lib/crm/api-auth', () => ({
  requireCrmOperatorSession: vi.fn(async () => ({ session: { userId: 'operator-1', email: 'ops@example.test' } })),
}));
vi.mock('@/lib/reservations/access', () => ({
  resolveReservationAccess: vi.fn(async () => ({ accountId: 'account-a', actorId: 'operator-1', operatorRole: 'operator', isOpsAdmin: false })),
}));
vi.mock('../lifecycle-autopilot-service', () => ({ recordAndProcessBookingEvent: vi.fn(async () => ({ ok: true })) }));

import { recordBookingOpsEvent } from '../events';
import {
  acknowledgeOperatorAlert,
  buildOperatorAlertDedupeKey,
  reconcileOperatorAlertConditions,
  sanitizeOperatorAlertMetadata,
  type OperatorAlertCondition,
} from '../operator-alerts';
import { evaluateOpsTurnover } from '../ops-alert-engine';
import { GET as listAlerts } from '@/app/api/dashboard/booking-ops/alerts/route';
import { GET as getAlert, PATCH as patchAlert } from '@/app/api/dashboard/booking-ops/alerts/[id]/route';

const now = '2026-07-13T04:00:00.000Z';
const condition: OperatorAlertCondition = {
  code: 'CLEANING_NOT_ACCEPTED',
  incidentFamily: 'CLEANING_DELAY',
  sourceDomain: 'turnover',
  sourceGate: 'cleaning',
  severity: 'warning',
  title: 'Уборка не принята',
  description: 'Уборка требует внимания.',
  recommendedAction: 'Назначьте исполнителя.',
  deadlineAt: '2026-07-13T05:00:00.000Z',
  metadata: { minutesToCheckIn: 90 },
};
const reconcile = (conditions: OperatorAlertCondition[] = [condition], at = now) => reconcileOperatorAlertConditions({
  accountId: 'account-a', bookingId: 'booking-1', propertyId: 'property-1', conditions, now: at,
  nextCheckInAt: '2026-07-13T06:00:00.000Z',
});

function alertRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'alert-1', account_id: 'account-a', booking_id: 'booking-1', property_id: 'property-1',
    alert_code: condition.code, incident_family: condition.incidentFamily, source_domain: condition.sourceDomain,
    source_gate: condition.sourceGate, severity: condition.severity, status: 'open', title: condition.title,
    description: condition.description, recommended_action: condition.recommendedAction,
    dedupe_key: buildOperatorAlertDedupeKey({ bookingId: 'booking-1', propertyId: 'property-1', ...condition }),
    detected_at: now, deadline_at: condition.deadlineAt, next_check_in_at: '2026-07-13T06:00:00.000Z',
    acknowledged_at: null, resolved_at: null, metadata: condition.metadata, created_at: now, updated_at: now,
    ...overrides,
  };
}

beforeEach(() => {
  database.state.bookings = [{ id: 'booking-1', account_id: 'account-a', property_id: 'property-1' }];
  database.state.alerts = [];
  database.state.duplicateRaceRow = null;
  vi.clearAllMocks();
});

describe('canonical Operator Alert reconciliation', () => {
  it('creates the first persistent alert', async () => {
    const result = await reconcile();
    expect(result).toMatchObject({ alertsCreated: 1, unchanged: 0 });
    expect(database.state.alerts).toHaveLength(1);
    expect(database.state.alerts[0]).toMatchObject({ account_id: 'account-a', incident_family: 'CLEANING_DELAY', source_domain: 'turnover' });
  });

  it('returns unchanged for an identical second evaluation', async () => {
    await reconcile();
    const second = await reconcile();
    expect(second).toMatchObject({ alertsCreated: 0, alertsUpdated: 0, unchanged: 1 });
    expect(database.state.alerts).toHaveLength(1);
  });

  it('updates an active alert when deadline, description, or action changes', async () => {
    database.state.alerts = [alertRow()];
    const changed = { ...condition, deadlineAt: '2026-07-13T04:30:00.000Z', description: 'Срок изменился.', recommendedAction: 'Свяжитесь с исполнителем.' };
    const result = await reconcile([changed]);
    expect(result.alertsUpdated).toBe(1);
    expect(database.state.alerts[0]).toMatchObject({ deadline_at: changed.deadlineAt, description: changed.description, recommended_action: changed.recommendedAction });
  });

  it('escalates and de-escalates the same active incident without duplicates', async () => {
    database.state.alerts = [alertRow()];
    const escalation = await reconcile([{ ...condition, severity: 'critical' }]);
    expect(escalation).toMatchObject({ alertsUpdated: 1, alertsEscalated: 1 });
    const decrease = await reconcile([{ ...condition, severity: 'info' }], '2026-07-13T04:05:00.000Z');
    expect(decrease).toMatchObject({ alertsUpdated: 1, alertsEscalated: 0 });
    expect(database.state.alerts).toHaveLength(1);
    expect(recordBookingOpsEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'ops_alert_escalated' }));
  });

  it('resolves a cleared condition and creates a new incident on recurrence', async () => {
    await reconcile();
    const firstId = database.state.alerts[0].id;
    expect((await reconcile([], '2026-07-13T04:10:00.000Z')).alertsResolved).toBe(1);
    expect(database.state.alerts[0].status).toBe('resolved');
    expect((await reconcile([condition], '2026-07-13T04:20:00.000Z')).alertsCreated).toBe(1);
    expect(database.state.alerts).toHaveLength(2);
    expect(database.state.alerts[1].id).not.toBe(firstId);
  });

  it('treats a duplicate-key creation race as idempotent success', async () => {
    database.state.duplicateRaceRow = alertRow({ id: 'raced-alert' });
    const result = await reconcile();
    expect(result).toMatchObject({ alertsCreated: 0, unchanged: 1 });
    expect(database.state.alerts).toHaveLength(1);
  });

  it('keeps acknowledgement active and allows later escalation', async () => {
    database.state.alerts = [alertRow()];
    const acknowledged = await acknowledgeOperatorAlert('account-a', 'alert-1', 'operator-1');
    expect(acknowledged.status).toBe('acknowledged');
    const escalated = await reconcile([{ ...condition, severity: 'critical' }]);
    expect(escalated.alertsEscalated).toBe(1);
    expect(database.state.alerts[0]).toMatchObject({ id: 'alert-1', status: 'acknowledged', severity: 'critical', resolved_at: null });
  });

  it('rejects a supplied account that does not own the booking', async () => {
    await expect(reconcileOperatorAlertConditions({
      accountId: 'account-b', bookingId: 'booking-1', propertyId: 'property-1', conditions: [condition], now,
    })).rejects.toThrow('booking_account_mismatch');
    expect(database.state.alerts).toEqual([]);
  });

  it('filters sensitive and unknown metadata', () => {
    expect(sanitizeOperatorAlertMetadata({
      minutesToCheckIn: 30, previousBookingId: 'booking-0', passportData: 'secret', messageBody: 'private', providerToken: 'token', arbitrary: 'value',
    })).toEqual({ minutesToCheckIn: 30, previousBookingId: 'booking-0' });
  });

  it('keeps the turnover engine incident key and generic fields compatible', () => {
    const result = evaluateOpsTurnover({
      turnoverId: 'booking-1', propertyId: 'property-1', nextBookingId: 'booking-1', now,
      nextCheckInAt: '2026-07-13T06:00:00.000Z', cleaning: null, linen: { status: 'verified' },
      inspection: { status: 'passed' }, maintenance: [], finalReady: true,
    });
    expect(result.conditions[0]).toMatchObject({
      incidentFamily: 'CLEANING_DELAY', sourceDomain: 'turnover', sourceGate: 'cleaning',
      dedupeKey: buildOperatorAlertDedupeKey({ bookingId: 'booking-1', propertyId: 'property-1', incidentFamily: 'CLEANING_DELAY', sourceDomain: 'turnover', sourceGate: 'cleaning' }),
    });
  });
});

describe('account-scoped alert routes', () => {
  it('lists only the current account alerts', async () => {
    database.state.alerts = [alertRow(), alertRow({ id: 'alert-b', account_id: 'account-b' })];
    const response = await listAlerts(new Request('http://localhost/api/dashboard/booking-ops/alerts'));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.alerts).toHaveLength(1);
    expect(body.alerts[0]).toMatchObject({ id: 'alert-1', accountId: 'account-a' });
  });

  it('returns not found for a cross-account GET', async () => {
    database.state.alerts = [alertRow({ id: 'alert-b', account_id: 'account-b' })];
    const response = await getAlert(new Request('http://localhost'), { params: { id: 'alert-b' } });
    expect(response.status).toBe(404);
  });

  it('denies cross-account acknowledgement', async () => {
    database.state.alerts = [alertRow({ id: 'alert-b', account_id: 'account-b' })];
    const response = await patchAlert(new Request('http://localhost', {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'acknowledge' }),
    }), { params: { id: 'alert-b' } });
    expect(response.status).toBe(404);
    expect(database.state.alerts[0].status).toBe('open');
  });
});
