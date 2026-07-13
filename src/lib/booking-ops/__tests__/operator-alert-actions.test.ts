import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  type Row = Record<string, unknown>;
  const state = {
    alert: null as Row | null,
    bookings: [] as Row[],
    workerTasks: [] as Row[],
    cleaningTasks: [] as Row[],
    domainEvents: [] as Row[],
    clearOnReconcile: false,
    draftCreated: true,
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
      if (this.table === 'booking_ops_worker_tasks') return state.workerTasks;
      if (this.table === 'booking_cleaning_tasks') return state.cleaningTasks;
      if (this.table === 'booking_ops_domain_events') return state.domainEvents;
      return [];
    }
    async maybeSingle() {
      const row = this.rows().find((item) => this.filters.every((filter) => filter(item))) ?? null;
      if (row && this.patch) Object.assign(row, this.patch);
      return { data: row ? { ...row } : null, error: null };
    }
    then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
      const rows = this.rows().filter((item) => this.filters.every((filter) => filter(item)));
      return Promise.resolve({ data: rows.map((row) => ({ ...row })), error: null }).then(resolve, reject);
    }
  }
  return {
    state,
    supabase: { from: (table: string) => new Query(table) },
    recordAudit: vi.fn(async (input: Row) => {
      state.domainEvents.push({ id: input.id, booking_id: input.bookingId, source: input.source, payload: input.payload, created_at: '2026-07-13T00:00:00Z' });
      return { processed: true };
    }),
    recordEvent: vi.fn(async (input: { payload?: Row }) => {
      const task = state.workerTasks.find((item) => item.id === input.payload?.taskId);
      if (task) task.status = 'completed';
      return { processed: true };
    }),
    createDraft: vi.fn(async () => ({ communication: { id: 'draft-1', status: 'draft_ready' }, created: state.draftCreated, actuallySent: false as const })),
    updateCleaning: vi.fn(async (_bookingId: string, body: Row) => {
      const task = state.cleaningTasks[0];
      if (task) task.status = body.status;
      return { cleaning: task ? { status: String(task.status) } : null };
    }),
    reconcile: vi.fn(async () => {
      if (state.clearOnReconcile && state.alert) state.alert.status = 'resolved';
      return { errors: [], alertsResolved: state.clearOnReconcile ? 1 : 0 };
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
  recordAndProcessBookingEvent: mocks.recordEvent,
  recordProcessedBookingAuditEvent: mocks.recordAudit,
}));
vi.mock('../ops-alert-orchestrator', () => ({ reconcileOperatorAlertsForBooking: mocks.reconcile }));
vi.mock('../physical-readiness-execution', () => ({ updateCleaningTask: mocks.updateCleaning }));
vi.mock('../operator-alerts', () => ({
  OPERATOR_ALERT_RESOLUTION_CATEGORIES: ['issue_fixed', 'duplicate_alert', 'false_positive', 'no_longer_applicable', 'manually_overridden'],
  getOperatorAlert: vi.fn(async (accountId: string) => mocks.state.alert?.accountId === accountId ? { ...mocks.state.alert } : null),
  acknowledgeOperatorAlert: vi.fn(async (_accountId: string, _alertId: string, actor: string) => ({ ...mocks.state.alert, status: 'acknowledged', acknowledgedBy: actor })),
  resolveOperatorAlertOccurrence: vi.fn(async (_accountId: string, _alertId: string, _actor: string, category: string, reason: string) => ({ ...mocks.state.alert, status: 'resolved', resolutionReason: `${category}:${reason}` })),
}));

import { applyOperatorAlertAction } from '../operator-exception-actions';

function alert(overrides: Record<string, unknown> = {}) {
  return {
    id: 'alert-1', accountId: 'account-a', bookingId: 'booking-1', propertyId: 'property-1', alertCode: 'CLEANING_NOT_STARTED',
    incidentFamily: 'CLEANING_DELAY', sourceDomain: 'turnover', sourceGate: 'cleaning', severity: 'warning', status: 'open',
    title: 'Уборка не завершена', description: 'Нужно действие.', recommendedAction: 'Проверьте уборку.', dedupeKey: 'key', detectedAt: '2026-07-13T00:00:00Z',
    deadlineAt: null, nextCheckInAt: null, acknowledgedAt: null, acknowledgedBy: null, resolvedAt: null, resolutionReason: null, metadata: {},
    ...overrides,
  };
}

beforeEach(() => {
  mocks.state.alert = alert();
  mocks.state.bookings = [{ id: 'booking-1', account_id: 'account-a', property_id: 'property-1', booking_id: 'ASI-1' }];
  mocks.state.workerTasks = [];
  mocks.state.cleaningTasks = [];
  mocks.state.domainEvents = [];
  mocks.state.clearOnReconcile = false;
  mocks.state.draftCreated = true;
  vi.clearAllMocks();
});

describe('Operator Alert canonical actions', () => {
  it('acknowledges without resolving and records the operator audit', async () => {
    const result = await applyOperatorAlertAction({ accountId: 'account-a', alertId: 'alert-1', action: 'acknowledge', actorId: 'operator-1', canOverrideHighRisk: false });
    expect(result.alert).toMatchObject({ status: 'acknowledged', acknowledgedBy: 'operator-1' });
    expect(mocks.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'operator-1', payload: expect.objectContaining({ actionType: 'acknowledge', accountId: 'account-a', noExternalSend: true }) }));
  });

  it('assigns an existing worker task by exact task identity', async () => {
    mocks.state.alert = alert({ sourceGate: 'inspection', metadata: { taskId: 'task-1' } });
    mocks.state.workerTasks = [{ id: 'task-1', booking_id: 'booking-1', object_id: 'property-1', task_key: 'booking-1:inspector', assigned_role: 'inspector', assigned_person_id: null, status: 'pending' }];
    await applyOperatorAlertAction({ accountId: 'account-a', alertId: 'alert-1', action: 'assign_executor', actorId: 'operator-1', canOverrideHighRisk: false, executorId: 'person-1' });
    expect(mocks.state.workerTasks[0]).toMatchObject({ id: 'task-1', assigned_person_id: 'person-1', status: 'assigned' });
  });

  it('assigns cleaning through the existing cleaning transition service', async () => {
    mocks.state.cleaningTasks = [{ id: 'cleaning-1', booking_id: 'booking-1', property_id: 'property-1', status: 'pending' }];
    await applyOperatorAlertAction({ accountId: 'account-a', alertId: 'alert-1', action: 'assign_executor', actorId: 'operator-1', canOverrideHighRisk: false, assignedToName: 'Исполнитель' });
    expect(mocks.updateCleaning).toHaveBeenCalledWith('booking-1', expect.objectContaining({ status: 'assigned', assignedToName: 'Исполнитель' }));
  });

  it('does not advance canonical work twice for a repeated idempotency key', async () => {
    mocks.state.cleaningTasks = [{ id: 'cleaning-1', booking_id: 'booking-1', property_id: 'property-1', status: 'assigned' }];
    const input = { accountId: 'account-a', alertId: 'alert-1', action: 'advance_work' as const, actorId: 'operator-1', canOverrideHighRisk: false, idempotencyKey: 'same-request' };
    await applyOperatorAlertAction(input);
    const repeated = await applyOperatorAlertAction(input);
    expect(mocks.updateCleaning).toHaveBeenCalledTimes(1);
    expect(repeated).toMatchObject({ idempotent: true });
  });

  it('creates a draft-only missing-data request and never sends externally', async () => {
    mocks.state.alert = alert({ sourceDomain: 'guest', sourceGate: 'guest_data_completed' });
    const result = await applyOperatorAlertAction({ accountId: 'account-a', alertId: 'alert-1', action: 'request_missing_data', actorId: 'operator-1', canOverrideHighRisk: false, missingDataReason: 'guest_data' });
    expect(result).toMatchObject({ communication: { id: 'draft-1', created: true }, actuallySent: false });
    expect(mocks.createDraft).toHaveBeenCalledWith(expect.objectContaining({ alertId: 'alert-1', reason: 'guest_data' }));
  });

  it('reuses an active request for the same reason', async () => {
    mocks.state.alert = alert({ sourceDomain: 'payment', sourceGate: 'deposit_received' });
    mocks.state.draftCreated = false;
    const result = await applyOperatorAlertAction({ accountId: 'account-a', alertId: 'alert-1', action: 'request_missing_data', actorId: 'operator-1', canOverrideHighRisk: false, missingDataReason: 'payment' });
    expect(result).toMatchObject({ communication: { id: 'draft-1', created: false }, actuallySent: false });
  });

  it('completes the exact assigned worker task through a lifecycle event', async () => {
    mocks.state.alert = alert({ sourceGate: 'inspection', metadata: { taskId: 'task-1' } });
    mocks.state.workerTasks = [{ id: 'task-1', booking_id: 'booking-1', object_id: 'property-1', task_key: 'booking-1:inspector', assigned_role: 'inspector', status: 'assigned' }];
    await applyOperatorAlertAction({ accountId: 'account-a', alertId: 'alert-1', action: 'advance_work', actorId: 'operator-1', canOverrideHighRisk: false });
    expect(mocks.recordEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'inspection.completed', payload: { taskId: 'task-1', taskKey: 'booking-1:inspector', alertId: 'alert-1' } }));
  });

  it('rejects completion from a blocked worker state', async () => {
    mocks.state.alert = alert({ sourceGate: 'inspection', metadata: { taskId: 'task-1' } });
    mocks.state.workerTasks = [{ id: 'task-1', booking_id: 'booking-1', object_id: 'property-1', task_key: 'booking-1:inspector', assigned_role: 'inspector', status: 'blocked' }];
    await expect(applyOperatorAlertAction({ accountId: 'account-a', alertId: 'alert-1', action: 'advance_work', actorId: 'operator-1', canOverrideHighRisk: false })).rejects.toThrow('worker_task_completion_invalid:blocked');
    expect(mocks.recordEvent).not.toHaveBeenCalled();
  });

  it('returns the automatically resolved alert after canonical completion clears the condition', async () => {
    mocks.state.alert = alert({ sourceGate: 'inspection', metadata: { taskId: 'task-1' } });
    mocks.state.workerTasks = [{ id: 'task-1', booking_id: 'booking-1', object_id: 'property-1', task_key: 'booking-1:inspector', assigned_role: 'inspector', status: 'assigned' }];
    mocks.state.clearOnReconcile = true;
    const result = await applyOperatorAlertAction({ accountId: 'account-a', alertId: 'alert-1', action: 'advance_work', actorId: 'operator-1', canOverrideHighRisk: false });
    expect(result.alert).toMatchObject({ status: 'resolved' });
  });

  it('requires an explicit category and reason for manual resolution', async () => {
    await expect(applyOperatorAlertAction({ accountId: 'account-a', alertId: 'alert-1', action: 'resolve_alert', actorId: 'operator-1', canOverrideHighRisk: false, resolutionCategory: 'issue_fixed' })).rejects.toThrow('resolution_reason_required');
    const result = await applyOperatorAlertAction({ accountId: 'account-a', alertId: 'alert-1', action: 'resolve_alert', actorId: 'operator-1', canOverrideHighRisk: false, resolutionCategory: 'issue_fixed', reason: 'Проверено оператором' });
    expect(result.alert).toMatchObject({ status: 'resolved', resolutionReason: 'issue_fixed:Проверено оператором' });
  });

  it('blocks manual closure of a critical alert without the existing admin permission', async () => {
    mocks.state.alert = alert({ severity: 'critical' });
    await expect(applyOperatorAlertAction({ accountId: 'account-a', alertId: 'alert-1', action: 'resolve_alert', actorId: 'operator-1', canOverrideHighRisk: false, resolutionCategory: 'false_positive', reason: 'Проверено' })).rejects.toThrow('high_risk_alert_override_forbidden');
  });
});
