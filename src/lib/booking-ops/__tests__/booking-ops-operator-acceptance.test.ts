import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const state = {
    alert: null as Row | null,
    bookings: [] as Row[],
    cleaning: [] as Row[],
    events: [] as Row[],
    drafts: new Map<string, Row>(),
    resolveOnReconcile: false,
  };
  class Query {
    private filters: Array<(row: Row) => boolean> = [];
    private patch: Row | null = null;
    constructor(private table: string) {}
    select() { return this; }
    update(patch: Row) { this.patch = patch; return this; }
    eq(column: string, value: unknown) { this.filters.push((row) => row[column] === value); return this; }
    in(column: string, values: unknown[]) { this.filters.push((row) => values.includes(row[column])); return this; }
    order() { return this; }
    limit() { return this; }
    private rows() {
      if (this.table === 'booking_ops_records') return state.bookings;
      if (this.table === 'booking_cleaning_tasks') return state.cleaning;
      if (this.table === 'booking_ops_domain_events') return state.events;
      return [];
    }
    async maybeSingle() {
      const row = this.rows().find((candidate) => this.filters.every((filter) => filter(candidate))) ?? null;
      if (row && this.patch) Object.assign(row, this.patch);
      return { data: row ? { ...row } : null, error: null };
    }
    then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
      const rows = this.rows().filter((candidate) => this.filters.every((filter) => filter(candidate)));
      return Promise.resolve({ data: rows.map((row) => ({ ...row })), error: null }).then(resolve, reject);
    }
  }
  return {
    state,
    supabase: { from: (table: string) => new Query(table) },
    audit: vi.fn(async (input: Row) => {
      state.events.push({ id: input.id, booking_id: input.bookingId, source: input.source, payload: input.payload, created_at: '2026-07-13T09:00:00Z' });
      return { processed: true };
    }),
    createDraft: vi.fn(async (input: Row) => {
      const key = `${input.bookingOpsRecordId}:${input.reason}`;
      const existing = state.drafts.get(key);
      if (existing) return { communication: existing, created: false, actuallySent: false as const };
      const communication = { id: `draft-${state.drafts.size + 1}`, status: 'draft_ready' };
      state.drafts.set(key, communication);
      return { communication, created: true, actuallySent: false as const };
    }),
    updateCleaning: vi.fn(async (_bookingId: string, body: Row) => {
      const row = state.cleaning[0];
      if (row) row.status = body.status;
      return { cleaning: row ? { status: String(row.status) } : null };
    }),
    reconcile: vi.fn(async () => {
      if (state.resolveOnReconcile && state.alert) state.alert.status = 'resolved';
      return { errors: [], alertsResolved: state.resolveOnReconcile ? 1 : 0 };
    }),
  };
});

vi.mock('@/lib/supabase', () => ({ supabase: mocks.supabase }));
vi.mock('../communication-orchestrator', () => ({
  OPERATOR_MISSING_DATA_REASONS: ['guest_data', 'guest_documents', 'legal_confirmation', 'payment', 'compliance', 'arrival', 'communication'],
  createOperatorMissingDataRequestDraft: mocks.createDraft,
}));
vi.mock('../lifecycle-autopilot-service', () => ({
  durableEventId: (...parts: string[]) => parts.join(':'),
  recordAndProcessBookingEvent: vi.fn(async () => ({ processed: true })),
  recordProcessedBookingAuditEvent: mocks.audit,
}));
vi.mock('../ops-alert-orchestrator', () => ({ reconcileOperatorAlertsForBooking: mocks.reconcile }));
vi.mock('../physical-readiness-execution', () => ({ updateCleaningTask: mocks.updateCleaning }));
vi.mock('../operator-alerts', () => ({
  OPERATOR_ALERT_RESOLUTION_CATEGORIES: ['issue_fixed', 'duplicate_alert', 'false_positive', 'no_longer_applicable', 'manually_overridden'],
  getOperatorAlert: vi.fn(async (accountId: string) => mocks.state.alert?.accountId === accountId ? { ...mocks.state.alert } : null),
  acknowledgeOperatorAlert: vi.fn(async (_accountId: string, _alertId: string, actor: string) => {
    if (mocks.state.alert) Object.assign(mocks.state.alert, { status: 'acknowledged', acknowledgedBy: actor, acknowledgedAt: '2026-07-13T09:01:00Z' });
    return { ...mocks.state.alert };
  }),
  resolveOperatorAlertOccurrence: vi.fn(async (_accountId: string, _alertId: string, _actor: string, category: string, reason: string) => {
    if (mocks.state.alert) Object.assign(mocks.state.alert, { status: 'resolved', resolutionReason: `${category}:${reason}`, resolvedAt: '2026-07-13T09:02:00Z' });
    return { ...mocks.state.alert };
  }),
}));

import { applyOperatorAlertAction } from '../operator-exception-actions';

function alert(overrides: Record<string, unknown> = {}) {
  return {
    id: 'alert-1', accountId: 'account-a', bookingId: 'booking-1', propertyId: 'property-1',
    alertCode: 'GUEST_DATA_INCOMPLETE', incidentFamily: 'GUEST_DATA', sourceDomain: 'guest', sourceGate: 'guest_data_completed',
    severity: 'warning', status: 'open', title: 'Missing data', description: 'Action required', recommendedAction: 'Request data',
    dedupeKey: 'guest-data', detectedAt: '2026-07-13T09:00:00Z', deadlineAt: null, nextCheckInAt: null,
    acknowledgedAt: null, acknowledgedBy: null, resolvedAt: null, resolutionReason: null, metadata: {},
    ...overrides,
  };
}

beforeEach(() => {
  mocks.state.alert = alert();
  mocks.state.bookings = [{ id: 'booking-1', account_id: 'account-a', property_id: 'property-1', booking_id: 'ASI-TEST-1' }];
  mocks.state.cleaning = [];
  mocks.state.events = [];
  mocks.state.drafts = new Map();
  mocks.state.resolveOnReconcile = false;
  vi.clearAllMocks();
});

describe('Booking Ops operator and alert acceptance', () => {
  it('acknowledges missing guest data, creates one draft-only request, and preserves the operator audit', async () => {
    const acknowledged = await applyOperatorAlertAction({ accountId: 'account-a', alertId: 'alert-1', action: 'acknowledge', actorId: 'operator-1', canOverrideHighRisk: false });
    const request = { accountId: 'account-a', alertId: 'alert-1', action: 'request_missing_data' as const, actorId: 'operator-1', canOverrideHighRisk: false, missingDataReason: 'guest_data' };
    const first = await applyOperatorAlertAction({ ...request, idempotencyKey: 'request-1' });
    const second = await applyOperatorAlertAction({ ...request, idempotencyKey: 'request-2' });

    expect(acknowledged.alert).toMatchObject({ status: 'acknowledged', acknowledgedBy: 'operator-1' });
    expect(first).toMatchObject({ communication: { created: true }, actuallySent: false });
    expect(second).toMatchObject({ communication: { created: false }, actuallySent: false });
    expect(mocks.state.drafts).toHaveLength(1);
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ noExternalSend: true }) }));
  });

  it('resolves a cleared payment condition automatically and keeps its acknowledged history auditable', async () => {
    mocks.state.alert = alert({ sourceDomain: 'payment', sourceGate: 'deposit_received', alertCode: 'DEPOSIT_NOT_RECEIVED', incidentFamily: 'DEPOSIT' });
    await applyOperatorAlertAction({ accountId: 'account-a', alertId: 'alert-1', action: 'acknowledge', actorId: 'operator-1', canOverrideHighRisk: false });
    const acknowledgedAt = mocks.state.alert?.acknowledgedAt;
    mocks.state.resolveOnReconcile = true;
    mocks.state.cleaning = [{ id: 'cleaning-1', booking_id: 'booking-1', property_id: 'property-1', status: 'assigned' }];
    mocks.state.alert = { ...mocks.state.alert, sourceDomain: 'turnover', sourceGate: 'cleaning' };
    const result = await applyOperatorAlertAction({ accountId: 'account-a', alertId: 'alert-1', action: 'advance_work', actorId: 'operator-1', canOverrideHighRisk: false });

    expect(result.alert).toMatchObject({ status: 'resolved', acknowledgedBy: 'operator-1', acknowledgedAt });
    expect(mocks.reconcile).toHaveBeenCalled();
  });

  it('assigns and advances canonical cleaning without forcing readiness, with repeated actions idempotent', async () => {
    mocks.state.alert = alert({ sourceDomain: 'turnover', sourceGate: 'cleaning', alertCode: 'CLEANING_NOT_STARTED', incidentFamily: 'CLEANING_DELAY' });
    mocks.state.cleaning = [{ id: 'cleaning-1', booking_id: 'booking-1', property_id: 'property-1', status: 'pending' }];
    await applyOperatorAlertAction({ accountId: 'account-a', alertId: 'alert-1', action: 'assign_executor', actorId: 'operator-1', canOverrideHighRisk: false, assignedToName: 'Test executor', idempotencyKey: 'assign' });
    expect(mocks.state.cleaning[0].status).toBe('assigned');

    const advance = (key: string) => applyOperatorAlertAction({ accountId: 'account-a', alertId: 'alert-1', action: 'advance_work', actorId: 'operator-1', canOverrideHighRisk: false, idempotencyKey: key });
    await advance('start');
    await advance('complete');
    await advance('verify');
    const repeated = await advance('verify');

    expect(mocks.state.cleaning[0].status).toBe('verified');
    expect(repeated).toMatchObject({ idempotent: true });
    expect(mocks.updateCleaning).toHaveBeenCalledTimes(4);
    expect(mocks.reconcile).toHaveBeenCalledTimes(4);
    expect(mocks.audit).toHaveBeenCalledTimes(4);
  });

  it('denies cross-account acknowledgement, assignment, drafts, resolution, and work progression', async () => {
    const base = { accountId: 'account-b', alertId: 'alert-1', actorId: 'operator-b', canOverrideHighRisk: true };
    const attempts = [
      applyOperatorAlertAction({ ...base, action: 'acknowledge' }),
      applyOperatorAlertAction({ ...base, action: 'assign_executor', assignedToName: 'Other' }),
      applyOperatorAlertAction({ ...base, action: 'request_missing_data', missingDataReason: 'guest_data' }),
      applyOperatorAlertAction({ ...base, action: 'advance_work' }),
      applyOperatorAlertAction({ ...base, action: 'resolve_alert', resolutionCategory: 'issue_fixed', reason: 'Other account' }),
    ];
    for (const attempt of attempts) await expect(attempt).rejects.toThrow('alert_not_found');
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.createDraft).not.toHaveBeenCalled();
    expect(mocks.updateCleaning).not.toHaveBeenCalled();
  });
});
