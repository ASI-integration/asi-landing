import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

const tables = {
  booking_instay_checkout: [] as Row[],
  booking_guest_stay_issues: [] as Row[],
  booking_ops_communication_intents: [] as Row[],
};

const lifecycle = {
  completed: [] as Array<{ bookingId: string; gateKey: string; metadata?: Record<string, unknown> }>,
  blocked: [] as Array<{ bookingId: string; gateKey: string; reason: string }>,
  inProgress: [] as Array<{ bookingId: string; gateKey: string }>,
};

let guestCheckedIn = false;
let guestCheckedOut = false;
let inspectionDone = false;
let depositReady = false;
let bookingClosed = false;

const record = {
  id: '11111111-1111-4111-8111-111111111111',
  bookingId: 'reservation-1',
  guestName: 'Анна',
  guestEmail: null,
  guestTelegram: '@anna',
  propertyId: 'prop-1',
  propertyLabel: 'Квартира 7',
};

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
  getBookingOpsRecord: vi.fn(async () => record),
}));

function buildLifecycleGates() {
  const gates: Array<{ gateKey: string; status: string }> = [];
  if (guestCheckedIn) gates.push({ gateKey: 'guest_checked_in', status: 'completed' });
  if (guestCheckedOut) gates.push({ gateKey: 'guest_checked_out', status: 'completed' });
  if (inspectionDone) gates.push({ gateKey: 'post_checkout_inspection_done', status: 'completed' });
  if (depositReady) gates.push({ gateKey: 'deposit_return_ready', status: 'completed' });
  if (bookingClosed) gates.push({ gateKey: 'booking_closed', status: 'completed' });
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
    lifecycle.completed = [];
    lifecycle.blocked = [];
    lifecycle.inProgress = [];
    guestCheckedIn = false;
    guestCheckedOut = false;
    inspectionDone = false;
    depositReady = false;
    bookingClosed = false;
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
      status: 'draft_ready',
    });
  });

  it('does not duplicate an active checkout instruction intent', async () => {
    guestCheckedIn = true;
    const { queueCheckoutInstructions } = await import('../instay-checkout-autopilot');

    await queueCheckoutInstructions(record.id);
    await queueCheckoutInstructions(record.id);

    expect(tables.booking_ops_communication_intents).toHaveLength(1);
  });

  it('mark guest checked out completes guest_checked_out gate', async () => {
    guestCheckedIn = true;
    const { markGuestCheckedOut } = await import('../instay-checkout-autopilot');

    const status = await markGuestCheckedOut(record.id);

    expect(status.status).toBe('checked_out');
    expect(lifecycle.completed.map((item) => item.gateKey)).toContain('guest_checked_out');
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

  it('mark booking closed completes booking_closed gate', async () => {
    guestCheckedIn = true;
    guestCheckedOut = true;
    inspectionDone = true;
    depositReady = true;
    const { markBookingClosed } = await import('../instay-checkout-autopilot');

    const status = await markBookingClosed(record.id);

    expect(status.status).toBe('closed');
    expect(lifecycle.completed.map((item) => item.gateKey)).toContain('booking_closed');
  });

  it('does not create fallback for normal pending checkout', async () => {
    guestCheckedIn = true;
    const { requestCheckoutConfirmation, createCheckoutFallbackIfNeeded } = await import('../instay-checkout-autopilot');

    await requestCheckoutConfirmation(record.id);
    const result = await createCheckoutFallbackIfNeeded(record.id, 'manual');

    expect(result.created).toBe(false);
    expect(lifecycle.blocked).toHaveLength(0);
  });
});
