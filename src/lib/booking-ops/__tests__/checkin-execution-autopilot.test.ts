import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

const tables = {
  booking_checkin_execution: [] as Row[],
  booking_ops_communication_intents: [] as Row[],
};

const lifecycle = {
  completed: [] as Array<{ bookingId: string; gateKey: string; metadata?: Record<string, unknown> }>,
  blocked: [] as Array<{ bookingId: string; gateKey: string; reason: string }>,
  inProgress: [] as Array<{ bookingId: string; gateKey: string }>,
};

let preCheckinStatus: 'needs_attention' | 'ready_for_checkin' = 'ready_for_checkin';
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
    lifecycle.completed = [];
    lifecycle.blocked = [];
    lifecycle.inProgress = [];
    preCheckinStatus = 'ready_for_checkin';
    preCheckinBlockers = [];
    guestCheckedIn = false;
    updateBookingOpsRecord.mockClear();
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

  it('queues instructions by creating one communication intent', async () => {
    const { queueCheckinInstructions } = await import('../checkin-execution-autopilot');

    const status = await queueCheckinInstructions(record.id);

    expect(status.status).toBe('instructions_queued');
    expect(tables.booking_ops_communication_intents).toHaveLength(1);
    expect(tables.booking_ops_communication_intents[0]).toMatchObject({
      purpose: 'checkin_instructions',
      status: 'draft_ready',
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
});
