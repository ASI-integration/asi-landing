import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

const tables = {
  booking_ops_records: [] as Row[],
  properties: [] as Row[],
  object_knowledge_entries: [] as Row[],
  booking_instay_checkout: [] as Row[],
  booking_guest_stay_issues: [] as Row[],
  booking_ops_communication_intents: [] as Row[],
  booking_ops_communication_policies: [] as Row[],
  booking_ops_communication_auto_send_attempts: [] as Row[],
};

const lifecycle = {
  completed: [] as Array<{ bookingId: string; gateKey: string; metadata?: Record<string, unknown> }>,
  blocked: [] as Array<{ bookingId: string; gateKey: string; reason: string }>,
  inProgress: [] as Array<{ bookingId: string; gateKey: string }>,
};

let issueStoreFails = false;
let guestCheckedIn = false;
let guestCheckedOut = false;
let inspectionDone = false;
let depositReady = false;
let bookingClosed = false;
let legalDocumentsStatus = 'verified';
let legalContractStatus = 'signed_manual';
let legalDepositStatus = 'paid_manual';
let legalMvdStatus = 'accepted_manual';
let recordOverrides: Row = {};
const syncBookingOpsTasksForRecordId = vi.fn(async () => ({ ok: true }));

const baseRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  bookingId: 'reservation-1',
  guestName: 'Анна',
  guestEmail: null,
  guestTelegram: '@anna',
  propertyId: 'prop-1',
  propertyLabel: 'Квартира 7',
  checkInAt: '2026-07-10T12:00:00.000Z',
  checkOutAt: '2026-07-12T10:00:00.000Z',
  guestCount: 2,
  documentRequired: true,
  contractRequired: true,
  depositRequired: true,
  mvdRequired: true,
};

const record = baseRecord;

function currentRecord() {
  return { ...baseRecord, ...recordOverrides };
}

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
      resolve(issueStoreFails && table === 'booking_guest_stay_issues'
        ? { data: null, error: { message: 'injected_issue_store_failure' } }
        : { data: result, error: null });
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
      item.id === row.id || (item.booking_id === row.booking_id && table === 'booking_instay_checkout'));
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
      update: vi.fn((patch: Row) => ({
        eq: vi.fn((column: string, value: unknown) => ({
          eq: vi.fn((column2: string, value2: unknown) => ({
            select: vi.fn(() => ({
              single: vi.fn(async () => {
                const row = rows('booking_guest_stay_issues').find((item) =>
                  item[column] === value && item[column2] === value2);
                if (!row) return { data: null, error: { message: 'not_found' } };
                Object.assign(row, patch);
                return { data: row, error: null };
              }),
            })),
          })),
        })),
      })),
    })),
  },
}));

vi.mock('../repository', () => ({
  getBookingOpsRecord: vi.fn(async () => currentRecord()),
  syncBookingOpsTasksForRecordId,
}));

vi.mock('../guest-legal-deposit-mvd-execution', () => {
  const readiness = (bookingId: string) => ({
    id: 'legal-readiness-1',
    bookingId,
    propertySetupId: null,
    propertyId: 'prop-1',
    status: legalDocumentsStatus === 'verified'
      && legalContractStatus === 'signed_manual'
      && legalDepositStatus === 'paid_manual'
      && legalMvdStatus === 'accepted_manual'
      ? 'ready_for_checkin'
      : 'incomplete',
    documentsStatus: legalDocumentsStatus,
    contractStatus: legalContractStatus,
    depositStatus: legalDepositStatus,
    mvdStatus: legalMvdStatus,
    availabilityStatus: 'no_conflict',
    blockers: [],
    warnings: [],
    safeSummary: 'ok',
    nextAction: null,
    lastCheckedAt: '2026-07-10T00:00:00.000Z',
    metadata: {},
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:00:00.000Z',
  });
  return {
    recomputeGuestLegalReadiness: vi.fn(async (bookingId: string) => readiness(bookingId)),
    getGuestLegalReadiness: vi.fn(async (bookingId: string) => readiness(bookingId)),
  };
});

function buildLifecycleGates() {
  const updatedAt = '2026-07-10T00:00:00.000Z';
  const gates: Array<{ gateKey: string; status: string; updatedAt: string }> = [];
  if (guestCheckedIn) gates.push({ gateKey: 'guest_checked_in', status: 'completed', updatedAt });
  if (guestCheckedOut) gates.push({ gateKey: 'guest_checked_out', status: 'completed', updatedAt });
  if (inspectionDone) gates.push({ gateKey: 'post_checkout_inspection_done', status: 'completed', updatedAt });
  if (depositReady) gates.push({ gateKey: 'deposit_return_ready', status: 'completed', updatedAt });
  if (bookingClosed) gates.push({ gateKey: 'booking_closed', status: 'completed', updatedAt });
  return gates;
}

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
      gates: buildLifecycleGates(),
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
      gates: buildLifecycleGates(),
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

describe('In-stay & Checkout Autopilot v1', () => {
  beforeEach(() => {
    tables.booking_instay_checkout = [];
    tables.booking_guest_stay_issues = [];
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
    issueStoreFails = false;
    guestCheckedIn = false;
    guestCheckedOut = false;
    inspectionDone = false;
    depositReady = false;
    bookingClosed = false;
    legalDocumentsStatus = 'verified';
    legalContractStatus = 'signed_manual';
    legalDepositStatus = 'paid_manual';
    legalMvdStatus = 'accepted_manual';
    recordOverrides = {};
    syncBookingOpsTasksForRecordId.mockClear();
  });

  it('pure in-stay and closeout reads do not initialize lifecycle or recompute legal readiness', async () => {
    guestCheckedIn = true;
    const lifecycleModule = await import('../lifecycle');
    const legalModule = await import('../guest-legal-deposit-mvd-execution');
    vi.mocked(lifecycleModule.initializeLifecycleForBooking).mockClear();
    vi.mocked(legalModule.recomputeGuestLegalReadiness).mockClear();
    vi.mocked(legalModule.getGuestLegalReadiness).mockClear();
    const service = await import('../instay-checkout-autopilot');
    const before = JSON.stringify(tables);

    const snapshot = await service.readInStayCheckoutStatus(record.id);
    const prerequisites = await service.readBookingClosePrerequisites(record.id, snapshot);

    expect(snapshot.status).toBe('in_stay');
    expect(prerequisites.map((item) => item.key)).toEqual(expect.arrayContaining([
      'guest_not_checked_out',
      'post_checkout_inspection_incomplete',
      'deposit_return_incomplete',
    ]));
    expect(lifecycleModule.initializeLifecycleForBooking).not.toHaveBeenCalled();
    expect(legalModule.recomputeGuestLegalReadiness).not.toHaveBeenCalled();
    expect(legalModule.getGuestLegalReadiness).toHaveBeenCalledWith(record.id);
    expect(JSON.stringify(tables)).toBe(before);
  });

  it.each(['prepared', 'returned', 'waived', 'incident', 'closed', 'closed_incident', 'closed_deposit'] as const)(
    'Wave 3 preserves actual close guard: %s', async state => {
    guestCheckedIn = true; guestCheckedOut = true; inspectionDone = true; depositReady = true;
    const service = await import('../instay-checkout-autopilot');
    const { getBookingOpsRecord } = await import('../repository');
    const { adaptResidentialOpsDecision } = await import('../../platform/ops-decision');
    const { isPlatformDecision } = await import('../../platform/decision');
    await service.markDepositReturnReady(record.id);
    if (state === 'returned' || state === 'incident') recordOverrides = { depositIntakeStatus: 'returned' };
    if (state === 'waived') tables.booking_instay_checkout[0].deposit_return_status = 'waived';
    if (state === 'closed' || state === 'closed_incident') {
      recordOverrides = { depositIntakeStatus: 'returned' };
      tables.booking_instay_checkout[0].deposit_return_status = 'returned';
    }
    if (state === 'incident' || state === 'closed_incident') await service.createGuestStayIssue(record.id, 'noise', 'medium', 'DO_NOT_LEAK');
    if (state.startsWith('closed')) bookingClosed = true;
    const checkout = await service.getInStayCheckoutStatus(record.id);
    const canonicalRecord = await getBookingOpsRecord(record.id);
    const prerequisites = await service.validateBookingClosePrerequisites(canonicalRecord!);
    const before = JSON.stringify(tables);
    const identity = { kind: 'identified' as const, accountId: 'account-1', propertyId: record.propertyId, bookingId: record.id };
    const now = Date.now();
    const decision = adaptResidentialOpsDecision(identity, 'closeout', {
      available: true, identity, observedAt: new Date(now).toISOString(), value: { kind: 'closeout', checkout, prerequisites },
    }, now);
    expect(isPlatformDecision(decision)).toBe(true);
    expect(decision.status).toBe(['returned', 'waived', 'closed'].includes(state) ? 'allowed' : 'blocked');
    expect(decision.permission.allowedActions.includes('close_booking')).toBe(state === 'returned' || state === 'waived');
    if (state === 'prepared') expect(decision.blockers).toContain('deposit_unresolved');
    if (state === 'incident' || state === 'closed_incident') expect(decision.blockers).toContain('open_incident');
    if (state === 'closed_deposit') expect(decision.blockers).toContain('deposit_unresolved');
    if (state.startsWith('closed')) {
      expect(decision.permission.forbiddenActions).toContain('confirm_checkout');
      expect(decision.permission.forbiddenActions).toContain('record_deposit_resolved');
      if (state === 'closed') expect(decision.permission.allowedActions).toEqual([]);
    }
    expect(JSON.stringify(decision)).not.toContain('DO_NOT_LEAK');
    expect(JSON.stringify(tables)).toBe(before);
  });

  it('returns not_checked_in when guest has not checked in', async () => {
    const { getInStayCheckoutStatus } = await import('../instay-checkout-autopilot');

    const status = await getInStayCheckoutStatus(record.id);

    expect(status.status).toBe('not_checked_in');
  });

  it('returns in_stay for checked-in booking', async () => {
    guestCheckedIn = true;
    const { getInStayCheckoutStatus } = await import('../instay-checkout-autopilot');

    const status = await getInStayCheckoutStatus(record.id);

    expect(status.status).toBe('in_stay');
  });

  it('create guest issue moves to guest_issue_open', async () => {
    guestCheckedIn = true;
    const { createGuestStayIssue } = await import('../instay-checkout-autopilot');

    const status = await createGuestStayIssue(record.id, 'noise', 'medium', 'Шум от соседей');

    expect(status.status).toBe('guest_issue_open');
    expect(status.openIssuesCount).toBe(1);
  });

  it('urgent guest issue is fallback eligible', async () => {
    guestCheckedIn = true;
    const { createGuestStayIssue, createCheckoutFallbackIfNeeded } = await import('../instay-checkout-autopilot');

    await createGuestStayIssue(record.id, 'safety', 'urgent', 'Нет горячей воды');
    const result = await createCheckoutFallbackIfNeeded(record.id, 'Срочная проблема');

    expect(result.created).toBe(true);
    expect(lifecycle.blocked.length).toBeGreaterThan(0);
  });

  it('resolve guest issue removes blocker', async () => {
    guestCheckedIn = true;
    const { createGuestStayIssue, resolveGuestStayIssue } = await import('../instay-checkout-autopilot');

    const created = await createGuestStayIssue(record.id, 'wifi', 'low', 'Нет Wi-Fi');
    const issueId = created.openIssues[0]?.id;
    expect(issueId).toBeTruthy();

    const resolved = await resolveGuestStayIssue(record.id, issueId!, 'Роутер перезагружен');

    expect(resolved.openIssuesCount).toBe(0);
    expect(resolved.blockers).toHaveLength(0);
  });

  it('queue checkout instructions creates communication intent', async () => {
    guestCheckedIn = true;
    const { queueCheckoutInstructions } = await import('../instay-checkout-autopilot');

    const status = await queueCheckoutInstructions(record.id);

    expect(status.status).toBe('checkout_instructions_queued');
    expect(tables.booking_ops_communication_intents).toHaveLength(1);
    expect(tables.booking_ops_communication_intents[0]).toMatchObject({
      purpose: 'checkout_instructions',
      status: 'waiting_for_external_input',
    });
  });

  it('does not duplicate an active checkout instruction intent', async () => {
    guestCheckedIn = true;
    const { queueCheckoutInstructions } = await import('../instay-checkout-autopilot');

    await queueCheckoutInstructions(record.id);
    await queueCheckoutInstructions(record.id);

    expect(tables.booking_ops_communication_intents).toHaveLength(1);
  });

  it('markCheckoutInstructionsSent creates checkout_reminder intent', async () => {
    guestCheckedIn = true;
    const { queueCheckoutInstructions, markCheckoutInstructionsSent } = await import('../instay-checkout-autopilot');

    await queueCheckoutInstructions(record.id);
    const status = await markCheckoutInstructionsSent(record.id);

    expect(status.status).toBe('checkout_pending');
    const purposes = tables.booking_ops_communication_intents.map((item) => item.purpose);
    expect(purposes).toContain('checkout_instructions');
    expect(purposes).toContain('checkout_reminder');
    expect(tables.booking_ops_communication_intents.filter((item) => item.purpose === 'checkout_reminder')).toHaveLength(1);
  });

  it('does not duplicate checkout_reminder on repeated mark_checkout_instructions_sent', async () => {
    guestCheckedIn = true;
    const { queueCheckoutInstructions, markCheckoutInstructionsSent } = await import('../instay-checkout-autopilot');

    await queueCheckoutInstructions(record.id);
    await markCheckoutInstructionsSent(record.id);
    const countAfterFirst = tables.booking_ops_communication_intents.length;
    await markCheckoutInstructionsSent(record.id);

    expect(tables.booking_ops_communication_intents).toHaveLength(countAfterFirst);
    expect(tables.booking_ops_communication_intents.filter((item) => item.purpose === 'checkout_reminder')).toHaveLength(1);
  });

  it('mark guest checked out completes guest_checked_out gate', async () => {
    guestCheckedIn = true;
    const { markGuestCheckedOut } = await import('../instay-checkout-autopilot');

    const status = await markGuestCheckedOut(record.id);

    expect(status.status).toBe('checked_out');
    expect(lifecycle.completed.map((item) => item.gateKey)).toContain('guest_checked_out');
    expect(syncBookingOpsTasksForRecordId).toHaveBeenCalledWith(record.id);
  });

  it('mark inspection done completes post_checkout_inspection_done gate', async () => {
    guestCheckedIn = true;
    guestCheckedOut = true;
    const { markPostCheckoutInspectionDone } = await import('../instay-checkout-autopilot');

    const status = await markPostCheckoutInspectionDone(record.id, 'ok');

    expect(status.inspectionStatus).toBe('done');
    expect(lifecycle.completed.map((item) => item.gateKey)).toContain('post_checkout_inspection_done');
  });

  it('mark deposit return ready completes deposit_return_ready gate', async () => {
    guestCheckedIn = true;
    guestCheckedOut = true;
    inspectionDone = true;
    const { markDepositReturnReady } = await import('../instay-checkout-autopilot');

    const status = await markDepositReturnReady(record.id);

    expect(status.depositReturnStatus).toBe('ready');
    expect(lifecycle.completed.map((item) => item.gateKey)).toContain('deposit_return_ready');
  });

  it('does not close while deposit return is only prepared, not actually returned', async () => {
    guestCheckedIn = true;
    guestCheckedOut = true;
    inspectionDone = true;
    depositReady = true;
    const { markBookingClosed } = await import('../instay-checkout-autopilot');

    await expect(markBookingClosed(record.id)).rejects.toMatchObject({
      missingPrerequisites: expect.arrayContaining([
        expect.objectContaining({ key: 'deposit_return_incomplete' }),
      ]),
    });
    expect(lifecycle.completed.map((item) => item.gateKey)).not.toContain('booking_closed');
  });

  it('mark booking closed completes booking_closed gate', async () => {
    guestCheckedIn = true;
    guestCheckedOut = true;
    inspectionDone = true;
    depositReady = true;
    recordOverrides = { depositIntakeStatus: 'returned' };
    const { markBookingClosed } = await import('../instay-checkout-autopilot');

    const status = await markBookingClosed(record.id);

    expect(status.status).toBe('closed');
    expect(lifecycle.completed.map((item) => item.gateKey)).toContain('booking_closed');
  });

  it('blocks booking close when documents are incomplete', async () => {
    guestCheckedIn = true;
    guestCheckedOut = true;
    inspectionDone = true;
    depositReady = true;
    recordOverrides = { depositIntakeStatus: 'returned' };
    legalDocumentsStatus = 'requested';
    const { markBookingClosed, BookingClosePrerequisiteError } = await import('../instay-checkout-autopilot');

    await expect(markBookingClosed(record.id)).rejects.toBeInstanceOf(BookingClosePrerequisiteError);
    await expect(markBookingClosed(record.id)).rejects.toMatchObject({
      missingPrerequisites: expect.arrayContaining([
        expect.objectContaining({ key: 'documents_incomplete' }),
      ]),
    });
    expect(lifecycle.completed.map((item) => item.gateKey)).not.toContain('booking_closed');
  });

  it('blocks booking close when deposit is incomplete', async () => {
    guestCheckedIn = true;
    guestCheckedOut = true;
    inspectionDone = true;
    depositReady = true;
    recordOverrides = { depositIntakeStatus: 'returned' };
    legalDepositStatus = 'pending';
    const { markBookingClosed } = await import('../instay-checkout-autopilot');

    await expect(markBookingClosed(record.id)).rejects.toMatchObject({
      missingPrerequisites: expect.arrayContaining([
        expect.objectContaining({ key: 'deposit_incomplete' }),
      ]),
    });
    expect(lifecycle.completed.map((item) => item.gateKey)).not.toContain('booking_closed');
  });

  it('blocks booking close when required guest data is missing', async () => {
    guestCheckedIn = true;
    guestCheckedOut = true;
    inspectionDone = true;
    depositReady = true;
    recordOverrides = { guestName: null, depositIntakeStatus: 'returned' };
    const { markBookingClosed } = await import('../instay-checkout-autopilot');

    await expect(markBookingClosed(record.id)).rejects.toMatchObject({
      missingPrerequisites: expect.arrayContaining([
        expect.objectContaining({ key: 'guest_name_missing' }),
      ]),
    });
    expect(lifecycle.completed.map((item) => item.gateKey)).not.toContain('booking_closed');
  });

  it('does not create fallback for normal pending checkout', async () => {
    guestCheckedIn = true;
    const { requestCheckoutConfirmation, createCheckoutFallbackIfNeeded } = await import('../instay-checkout-autopilot');

    await requestCheckoutConfirmation(record.id);
    const result = await createCheckoutFallbackIfNeeded(record.id, 'manual');

    expect(result.created).toBe(false);
    expect(lifecycle.blocked).toHaveLength(0);
  });

  it('does not close or hide incidents when the issue store cannot be read', async () => {
    guestCheckedIn = true; guestCheckedOut = true; inspectionDone = true;
    recordOverrides = { depositIntakeStatus: 'returned' };
    issueStoreFails = true;
    const { markBookingClosed, getInStayCheckoutStatus } = await import('../instay-checkout-autopilot');
    await expect(markBookingClosed(record.id)).rejects.toThrow('injected_issue_store_failure');
    await expect(getInStayCheckoutStatus(record.id)).rejects.toThrow('injected_issue_store_failure');
    expect(tables.booking_instay_checkout).toHaveLength(0);
    expect(lifecycle.completed).toHaveLength(0);
  });
  it('does not mark closed when the canonical close gate write fails', async () => {
    guestCheckedIn = true; guestCheckedOut = true; inspectionDone = true;
    recordOverrides = { depositIntakeStatus: 'returned' };
    const { completeGate } = await import('../lifecycle');
    vi.mocked(completeGate).mockResolvedValueOnce({ ok: false, error: 'injected_close_write_failure' });
    const { markBookingClosed } = await import('../instay-checkout-autopilot');
    await expect(markBookingClosed(record.id)).rejects.toThrow('injected_close_write_failure');
    expect(tables.booking_instay_checkout).toHaveLength(0);
  });
});
