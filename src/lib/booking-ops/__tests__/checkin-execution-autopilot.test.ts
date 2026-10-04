import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

const tables = {
  booking_ops_records: [] as Row[],
  properties: [] as Row[],
  object_knowledge_entries: [] as Row[],
  booking_checkin_execution: [] as Row[],
  booking_ops_communication_intents: [] as Row[],
  booking_ops_communication_policies: [] as Row[],
  booking_ops_communication_auto_send_attempts: [] as Row[],
};

const lifecycle = {
  completed: [] as Array<{ bookingId: string; gateKey: string; metadata?: Record<string, unknown> }>,
  blocked: [] as Array<{ bookingId: string; gateKey: string; reason: string }>,
  inProgress: [] as Array<{ bookingId: string; gateKey: string }>,
};

let preCheckinStatus: 'needs_attention' | 'ready_for_checkin' | 'blocked' = 'ready_for_checkin';
let preCheckinBlockers: Array<Record<string, unknown>> = [];
let guestCheckedIn = false;

const record = {
  id: '11111111-1111-4111-8111-111111111111',
  bookingId: 'reservation-1',
  guestName: 'Анна',
  guestEmail: null,
  guestTelegram: '@anna',
  propertyId: 'prop-1',
  propertyLabel: 'Квартира 7',
};

const updateBookingOpsRecord = vi.fn(async () => ({ ok: true, record }));
const requireBookingOpsRecordScope = vi.fn(async () => record);

vi.mock('../guest-legal-deposit-mvd-execution', () => ({
  shouldBlockCheckinInstructions: vi.fn(async () => ({ block: false, readiness: null, reason: null })),
  getGuestLegalReadiness: vi.fn(async () => null),
  shouldBlockLegalCommunication: vi.fn(() => ({ block: false, reviewRequired: false, reason: null })),
}));

function rows(table: keyof typeof tables): Row[] {
  return tables[table];
}

function makeSelect(table: keyof typeof tables) {
  let result = [...rows(table)];
  const query = {
    eq(column: string, value: unknown) {
      result = result.filter((row) => row[column] === value);
      return query;
    },
    in(column: string, values: unknown[]) {
      result = result.filter((row) => values.includes(row[column]));
      return query;
    },
    order() {
      return query;
    },
    maybeSingle: vi.fn(async () => ({ data: result[0] ?? null, error: null })),
    single: vi.fn(async () => ({ data: result[0] ?? null, error: result[0] ? null : { message: 'not_found' } })),
    then(resolve: (value: unknown) => void) {
      resolve({ data: result, error: null });
    },
  };
  return query;
}

function makeWriteResult(data: Row | Row[]) {
  return {
    select: vi.fn(() => ({
      single: vi.fn(async () => ({ data: Array.isArray(data) ? data[0] : data, error: null })),
      maybeSingle: vi.fn(async () => ({ data: Array.isArray(data) ? data[0] : data, error: null })),
    })),
    then(resolve: (value: unknown) => void) {
      resolve({ data, error: null });
    },
  };
}

function upsert(table: keyof typeof tables, input: Row | Row[]) {
  const incoming = Array.isArray(input) ? input : [input];
  const target = rows(table);
  for (const row of incoming) {
    const index = target.findIndex((item) =>
      item.id === row.id || (item.booking_id === row.booking_id && table === 'booking_checkin_execution'));
    if (index >= 0) target[index] = { ...target[index], ...row };
    else target.push(row);
  }
  return makeWriteResult(Array.isArray(input) ? incoming : incoming[0]);
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: keyof typeof tables) => ({
      select: vi.fn(() => makeSelect(table)),
      insert: vi.fn((input: Row | Row[]) => {
        rows(table).push(...(Array.isArray(input) ? input : [input]));
        return makeWriteResult(input);
      }),
      upsert: vi.fn((input: Row | Row[]) => upsert(table, input)),
    })),
  },
}));

vi.mock('../repository', () => ({
  getBookingOpsRecord: vi.fn(async () => record),
  requireBookingOpsRecordScope,
  updateBookingOpsRecord,
}));

vi.mock('../pre-checkin-control-center', () => ({
  getPreCheckinStatus: vi.fn(async () => ({
    bookingId: record.id,
    status: preCheckinStatus,
    readinessScore: preCheckinStatus === 'ready_for_checkin' ? 100 : 50,
    hardBlockers: preCheckinBlockers,
    warnings: [],
    requiredActions: [],
    timeline: [],
    topBlocker: preCheckinBlockers[0] ?? null,
    lifecycleScore: 80,
    lastRecomputedAt: '2026-06-30T10:00:00.000Z',
    metadata: {},
  })),
  readPreCheckinStatus: vi.fn(async () => ({
    bookingId: record.id,
    status: preCheckinStatus,
    readinessScore: preCheckinStatus === 'ready_for_checkin' ? 100 : 50,
    hardBlockers: preCheckinBlockers,
    warnings: [],
    requiredActions: [],
    timeline: [],
    topBlocker: preCheckinBlockers[0] ?? null,
    lifecycleScore: 80,
    lastRecomputedAt: '2026-06-30T10:00:00.000Z',
    metadata: { readMode: 'persisted_current_state' },
  })),
}));

vi.mock('../lifecycle', () => ({
  initializeLifecycleForBooking: vi.fn(async () => ({ ok: true, gates: [] })),
  markGateInProgress: vi.fn(async (bookingId: string, gateKey: string) => {
    lifecycle.inProgress.push({ bookingId, gateKey });
    return { ok: true };
  }),
  completeGate: vi.fn(async (bookingId: string, gateKey: string, metadata?: Record<string, unknown>) => {
    lifecycle.completed.push({ bookingId, gateKey, metadata });
    return { ok: true };
  }),
  blockGate: vi.fn(async (bookingId: string, gateKey: string, reason: string) => {
    lifecycle.blocked.push({ bookingId, gateKey, reason });
    return { ok: true };
  }),
  adminUpdateLifecycleGate: vi.fn(async () => ({ ok: true })),
  getLifecycleStatus: vi.fn(async () => ({
    ok: true,
    lifecycle: {
      bookingId: record.id,
      gates: guestCheckedIn ? [{ gateKey: 'guest_checked_in', status: 'completed' }] : [],
      readinessScore: 100,
      currentActiveGate: null,
      blockedGates: [],
      completedGates: [],
      nextRequiredGates: [],
      exceptions: [],
    },
  })),
  readLifecycleStatus: vi.fn(async () => ({
    ok: true,
    lifecycle: {
      bookingId: record.id,
      gates: guestCheckedIn ? [{ gateKey: 'guest_checked_in', status: 'completed' }] : [],
      readinessScore: 100,
      currentActiveGate: null,
      blockedGates: [],
      completedGates: [],
      nextRequiredGates: [],
      exceptions: [],
    },
  })),
}));

vi.mock('../communication-orchestrator', () => ({
  listBookingOpsCommunicationsForRecord: vi.fn(async () => ({
    ok: true,
    communications: tables.booking_ops_communication_intents.map((row) => ({
      id: String(row.id),
      bookingOpsRecordId: String(row.booking_ops_record_id),
      bookingId: String(row.booking_id ?? '') || null,
      relatedTaskId: row.related_task_id ? String(row.related_task_id) : null,
      actorType: row.actor_type,
      actorLabel: row.actor_label,
      purpose: row.purpose,
      channel: row.channel,
      status: row.status,
      messageText: row.message_text,
      messageTemplateKey: row.message_template_key,
      metadata: row.metadata ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      supersededAt: row.superseded_at ?? null,
    })),
  })),
}));

describe('Check-in Execution Autopilot v1', () => {
  beforeEach(() => {
    tables.booking_checkin_execution = [];
    tables.booking_ops_communication_intents = [];
    tables.booking_ops_records = [{
      id: record.id, booking_id: record.bookingId, property_id: record.propertyId,
      account_id: 'account-1', ops_status: 'created', updated_at: new Date().toISOString(),
    }];
    tables.properties = [{ id: record.propertyId, account_id: 'account-1' }];
    tables.object_knowledge_entries = [];
    lifecycle.completed = [];
    lifecycle.blocked = [];
    lifecycle.inProgress = [];
    preCheckinStatus = 'ready_for_checkin';
    preCheckinBlockers = [];
    guestCheckedIn = false;
    updateBookingOpsRecord.mockClear();
    requireBookingOpsRecordScope.mockReset();
    requireBookingOpsRecordScope.mockResolvedValue(record);
  });

  it.each(['unprepared', 'prepared', 'checked_in', 'access_issue', 'cleaning'] as const)(
    'Wave 3 adapts the actual check-in snapshot: %s', async state => {
    vi.useFakeTimers();
    const observedAt = '2026-06-30T10:00:00.000Z';
    vi.setSystemTime(new Date(observedAt));
    try {
      const { markAccessReady, prepareCheckinInstructions, getCheckinExecutionStatus } = await import('../checkin-execution-autopilot');
      const { adaptResidentialOpsDecision } = await import('../../platform/ops-decision');
      const { isPlatformDecision } = await import('../../platform/decision');
      const { shouldBlockCheckinInstructions } = await import('../guest-legal-deposit-mvd-execution');
      const legalGuard: Awaited<ReturnType<typeof shouldBlockCheckinInstructions>> = { block: false, reason: null, readiness: {
        id: 'legal-1', bookingId: record.id, propertySetupId: null, propertyId: record.propertyId,
        status: 'ready_for_checkin', documentsStatus: 'verified', contractStatus: 'signed_manual',
        depositStatus: 'paid_manual', mvdStatus: 'accepted_manual', availabilityStatus: 'no_conflict',
        blockers: [], warnings: [], safeSummary: null, nextAction: null, lastCheckedAt: observedAt,
        metadata: {}, createdAt: observedAt, updatedAt: observedAt,
      } };
      await markAccessReady(record.id);
      if (state === 'prepared') await prepareCheckinInstructions(record.id);
      if (state === 'checked_in') guestCheckedIn = true;
      if (state === 'access_issue') {
        guestCheckedIn = true;
        tables.booking_checkin_execution[0].access_status = 'issue';
      }
      if (state === 'cleaning') {
        preCheckinStatus = 'blocked';
        preCheckinBlockers = [{ key: 'physical:cleaning_not_verified', title: 'Cleaning', reason: 'DO_NOT_LEAK', fallbackEligible: true }];
      }
      const snapshot = await getCheckinExecutionStatus(record.id);
      const before = JSON.stringify(tables);
      const identity = { kind: 'identified' as const, accountId: 'account-1', propertyId: record.propertyId, bookingId: record.id };
      const decision = adaptResidentialOpsDecision(identity, 'checkin', {
        available: true, identity, observedAt, value: { kind: 'checkin', checkin: snapshot, legalGuard },
      }, Date.now());
      expect(isPlatformDecision(decision)).toBe(true);
      expect(decision.status).toBe(state === 'cleaning' || state === 'access_issue' ? 'blocked'
        : state === 'unprepared' ? 'review_required' : 'allowed');
      expect(decision.permission.allowedActions.includes('release_access')).toBe(state === 'prepared');
      expect(decision.permission.allowedActions.includes('release_instructions')).toBe(state === 'prepared');
      if (state === 'checked_in') expect(decision.permission.allowedActions).toEqual([]);
      expect(decision.permission.automaticActionAllowed).toBe(false);
      expect(JSON.stringify(decision)).not.toContain('DO_NOT_LEAK');
      expect(JSON.stringify(tables)).toBe(before);
    } finally { vi.useRealTimers(); }
  });

  it('returns not_ready when pre-checkin has blockers', async () => {
    preCheckinStatus = 'needs_attention';
    preCheckinBlockers = [{ key: 'documents', title: 'Документы', reason: 'Нет документов', fallbackEligible: false }];
    const { getCheckinExecutionStatus } = await import('../checkin-execution-autopilot');

    const status = await getCheckinExecutionStatus(record.id);

    expect(status.status).toBe('not_ready');
  });

  it('returns ready_to_send_instructions for ready booking', async () => {
    const { getCheckinExecutionStatus } = await import('../checkin-execution-autopilot');

    const status = await getCheckinExecutionStatus(record.id);

    expect(status.status).toBe('ready_to_send_instructions');
  });

  it('pure check-in read does not initialize lifecycle or call the mutating pre-checkin getter', async () => {
    const lifecycleModule = await import('../lifecycle');
    const preCheckinModule = await import('../pre-checkin-control-center');
    vi.mocked(lifecycleModule.initializeLifecycleForBooking).mockClear();
    vi.mocked(preCheckinModule.getPreCheckinStatus).mockClear();
    vi.mocked(preCheckinModule.readPreCheckinStatus).mockClear();

    const { readCheckinExecutionStatus } = await import('../checkin-execution-autopilot');
    const before = JSON.stringify(tables);
    const status = await readCheckinExecutionStatus(record.id);

    expect(status.status).toBe('ready_to_send_instructions');
    expect(lifecycleModule.initializeLifecycleForBooking).not.toHaveBeenCalled();
    expect(preCheckinModule.getPreCheckinStatus).not.toHaveBeenCalled();
    expect(preCheckinModule.readPreCheckinStatus).toHaveBeenCalledWith(record.id);
    expect(JSON.stringify(tables)).toBe(before);
  });

  it('queues instructions by creating one communication intent', async () => {
    const { queueCheckinInstructions } = await import('../checkin-execution-autopilot');

    const status = await queueCheckinInstructions(record.id);

    expect(status.status).toBe('instructions_queued');
    expect(tables.booking_ops_communication_intents).toHaveLength(1);
    expect(tables.booking_ops_communication_intents[0]).toMatchObject({
      purpose: 'checkin_instructions',
      status: 'waiting_for_external_input',
    });
  });

  it('blocks check-in instructions when property readiness is incomplete', async () => {
    preCheckinStatus = 'blocked';
    preCheckinBlockers = [{
      key: 'physical:cleaning_not_verified',
      title: 'Уборка проверена',
      reason: 'Уборка не завершена.',
      fallbackEligible: true,
    }];
    const { queueCheckinInstructions, CheckinReadinessPrerequisiteError } = await import('../checkin-execution-autopilot');

    await expect(queueCheckinInstructions(record.id)).rejects.toBeInstanceOf(CheckinReadinessPrerequisiteError);
    await expect(queueCheckinInstructions(record.id)).rejects.toMatchObject({
      missingPrerequisites: [
        expect.objectContaining({ key: 'physical:cleaning_not_verified' }),
      ],
    });
  });

  it('does not duplicate an active instruction intent', async () => {
    const { queueCheckinInstructions } = await import('../checkin-execution-autopilot');

    await queueCheckinInstructions(record.id);
    await queueCheckinInstructions(record.id);

    expect(tables.booking_ops_communication_intents).toHaveLength(1);
  });

  it('marks instructions sent and completes lifecycle gate', async () => {
    const { markCheckinInstructionsSent } = await import('../checkin-execution-autopilot');

    const status = await markCheckinInstructionsSent(record.id);

    expect(status.instructionsStatus).toBe('sent');
    expect(lifecycle.completed.map((item) => item.gateKey)).toContain('checkin_instructions_sent');
  });

  it('marks arrival confirmed', async () => {
    const { markArrivalConfirmed } = await import('../checkin-execution-autopilot');

    const status = await markArrivalConfirmed(record.id, '2026-06-30T12:00:00.000Z');

    expect(status.arrivalStatus).toBe('confirmed');
    expect(status.status).toBe('arrival_confirmed');
  });

  it('marks access ready and completes property_ready', async () => {
    const { markAccessReady } = await import('../checkin-execution-autopilot');

    const status = await markAccessReady(record.id);

    expect(status.accessStatus).toBe('ready');
    expect(lifecycle.completed.map((item) => item.gateKey)).toContain('property_ready');
  });

  it('reports access issue and creates blocker intent', async () => {
    const { reportAccessIssue } = await import('../checkin-execution-autopilot');

    const status = await reportAccessIssue(record.id, 'Гость не может открыть дверь', { doorCode: '1234' });

    expect(status.status).toBe('access_issue');
    expect(lifecycle.blocked[0]).toMatchObject({ gateKey: 'property_ready' });
    expect(tables.booking_ops_communication_intents[0]).toMatchObject({ purpose: 'access_issue_followup' });
    expect(JSON.stringify(tables.booking_ops_communication_intents[0].metadata)).not.toContain('1234');
  });

  it('fails closed when the access-issue lifecycle block cannot be persisted', async () => {
    const lifecycleModule = await import('../lifecycle');
    vi.mocked(lifecycleModule.blockGate).mockResolvedValueOnce({ ok: false, error: 'injected_gate_write_failure' });
    const { reportAccessIssue } = await import('../checkin-execution-autopilot');

    await expect(reportAccessIssue(
      record.id,
      'Гость не может открыть дверь',
      undefined,
      { accountId: 'account-1', propertyId: record.propertyId },
    )).rejects.toThrow('injected_gate_write_failure');

    expect(tables.booking_ops_communication_intents).toHaveLength(0);
    expect(tables.booking_checkin_execution).toHaveLength(0);
    expect(updateBookingOpsRecord).not.toHaveBeenCalled();
  });

  it('does not create fallback for normal pending arrival', async () => {
    const { requestArrivalConfirmation, createCheckinFallbackIfNeeded } = await import('../checkin-execution-autopilot');

    await requestArrivalConfirmation(record.id);
    const result = await createCheckinFallbackIfNeeded(record.id, 'manual');

    expect(result.created).toBe(false);
    expect(lifecycle.blocked).toHaveLength(0);
  });

  it('marks guest checked in and completes lifecycle gate', async () => {
    const { markGuestCheckedIn } = await import('../checkin-execution-autopilot');

    const status = await markGuestCheckedIn(record.id);

    expect(status.status).toBe('checked_in');
    expect(lifecycle.completed.map((item) => item.gateKey)).toContain('guest_checked_in');
  });

  it('fails closed before check-in mutation when canonical scope no longer matches', async () => {
    requireBookingOpsRecordScope.mockRejectedValueOnce(new Error('booking_scope_mismatch'));
    const { runCheckinExecutionAction } = await import('../checkin-execution-autopilot');

    await expect(runCheckinExecutionAction({
      bookingId: record.id,
      action: 'mark_guest_checked_in',
      expectedScope: { accountId: 'account-1', propertyId: record.propertyId },
    })).rejects.toThrow('booking_scope_mismatch');

    expect(lifecycle.completed).toHaveLength(0);
    expect(updateBookingOpsRecord).not.toHaveBeenCalled();
    expect(tables.booking_checkin_execution).toHaveLength(0);
  });

  it('keeps canonical scope through access resolution', async () => {
    const lifecycleModule = await import('../lifecycle');
    vi.mocked(lifecycleModule.adminUpdateLifecycleGate).mockClear();
    const { runCheckinExecutionAction } = await import('../checkin-execution-autopilot');
    const expectedScope = { accountId: 'account-1', propertyId: record.propertyId };

    const status = await runCheckinExecutionAction({
      bookingId: record.id,
      action: 'resolve_access_issue',
      reason: 'resolved',
      expectedScope,
    });

    expect(status.accessStatus).toBe('resolved');
    expect(lifecycleModule.adminUpdateLifecycleGate).toHaveBeenCalledWith(
      expect.objectContaining({ bookingId: record.id, expectedScope }),
    );
    expect(requireBookingOpsRecordScope).toHaveBeenCalledWith(record.id, expectedScope);
  });

  it('fails closed when access-resolution lifecycle persistence fails', async () => {
    const lifecycleModule = await import('../lifecycle');
    vi.mocked(lifecycleModule.adminUpdateLifecycleGate).mockResolvedValueOnce({
      ok: false,
      error: 'injected_gate_write_failure',
    });
    const { runCheckinExecutionAction } = await import('../checkin-execution-autopilot');

    await expect(runCheckinExecutionAction({
      bookingId: record.id,
      action: 'resolve_access_issue',
      expectedScope: { accountId: 'account-1', propertyId: record.propertyId },
    })).rejects.toThrow('injected_gate_write_failure');

    expect(tables.booking_checkin_execution).toHaveLength(0);
  });

  it('keeps canonical scope through fallback creation', async () => {
    preCheckinStatus = 'blocked';
    preCheckinBlockers = [{
      key: 'physical:cleaning_not_verified',
      title: 'Cleaning',
      reason: 'Not ready',
      fallbackEligible: true,
    }];
    const lifecycleModule = await import('../lifecycle');
    vi.mocked(lifecycleModule.blockGate).mockClear();
    const { runCheckinExecutionAction } = await import('../checkin-execution-autopilot');
    const expectedScope = { accountId: 'account-1', propertyId: record.propertyId };

    await runCheckinExecutionAction({
      bookingId: record.id,
      action: 'create_fallback',
      reason: 'manual plan',
      expectedScope,
    });

    expect(vi.mocked(lifecycleModule.blockGate).mock.calls[0]?.[4]).toEqual(expectedScope);
  });

  it('fails closed before a scoped note write if ownership changes', async () => {
    requireBookingOpsRecordScope
      .mockResolvedValueOnce(record)
      .mockRejectedValueOnce(new Error('booking_scope_mismatch'));
    const { runCheckinExecutionAction } = await import('../checkin-execution-autopilot');

    await expect(runCheckinExecutionAction({
      bookingId: record.id,
      action: 'add_note',
      note: 'operator note',
      expectedScope: { accountId: 'account-1', propertyId: record.propertyId },
    })).rejects.toThrow('booking_scope_mismatch');

    expect(tables.booking_checkin_execution).toHaveLength(0);
  });

  it('scopes baseline initialization before persistence', async () => {
    requireBookingOpsRecordScope.mockRejectedValueOnce(new Error('booking_scope_mismatch'));
    const { initializeCheckinExecutionBaseline } = await import('../checkin-execution-autopilot');

    await expect(initializeCheckinExecutionBaseline(
      record.id,
      { accountId: 'account-1', propertyId: record.propertyId },
    )).rejects.toThrow('booking_scope_mismatch');

    expect(tables.booking_checkin_execution).toHaveLength(0);
  });

  it('revalidates canonical scope immediately before arrival execution persistence', async () => {
    requireBookingOpsRecordScope
      .mockResolvedValueOnce(record)
      .mockRejectedValueOnce(new Error('booking_scope_mismatch'));
    const { markArrivalConfirmed } = await import('../checkin-execution-autopilot');

    await expect(markArrivalConfirmed(
      record.id,
      '2026-06-30T12:00:00.000Z',
      undefined,
      { accountId: 'account-1', propertyId: record.propertyId },
    )).rejects.toThrow('booking_scope_mismatch');

    expect(tables.booking_checkin_execution).toHaveLength(0);
  });

  it.each(['markGuestCheckedIn', 'markAccessReady', 'markCheckinInstructionsSent'] as const)(
    '%s fails closed when the required lifecycle write fails',
    async (action) => {
      const { completeGate } = await import('../lifecycle');
      vi.mocked(completeGate).mockResolvedValueOnce({ ok: false, error: 'injected_gate_write_failure' });
      const service = await import('../checkin-execution-autopilot');
      await expect(service[action](record.id)).rejects.toThrow('injected_gate_write_failure');
      expect(tables.booking_checkin_execution).toHaveLength(0);
      expect(updateBookingOpsRecord).not.toHaveBeenCalled();
    },
  );
});
