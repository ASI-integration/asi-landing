import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

const tables = {
  booking_guest_documents: [] as Row[],
  booking_contracts: [] as Row[],
  booking_deposits: [] as Row[],
  booking_mvd_reports: [] as Row[],
  booking_ops_communication_intents: [] as Row[],
};

const lifecycle = {
  initialized: [] as string[],
  completed: [] as Array<{ bookingId: string; gateKey: string; metadata?: Record<string, unknown> }>,
  blocked: [] as Array<{ bookingId: string; gateKey: string; reason: string }>,
  inProgress: [] as Array<{ bookingId: string; gateKey: string }>,
};

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

function tableRows(table: keyof typeof tables): Row[] {
  return tables[table];
}

function makeSelect(table: keyof typeof tables) {
  let result = [...tableRows(table)];
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
    limit(count: number) {
      result = result.slice(0, count);
      return query;
    },
    maybeSingle: vi.fn(async () => ({ data: result[0] ?? null, error: null })),
    then(resolve: (value: unknown) => void) {
      resolve({ data: result, error: null });
    },
  };
  return query;
}

function makeUpdate(table: keyof typeof tables, patch: Row) {
  let indexes = tableRows(table).map((_, index) => index);
  const query = {
    eq(column: string, value: unknown) {
      indexes = indexes.filter((index) => tableRows(table)[index][column] === value);
      for (const index of indexes) Object.assign(tableRows(table)[index], patch);
      return query;
    },
    in(column: string, values: unknown[]) {
      indexes = indexes.filter((index) => values.includes(tableRows(table)[index][column]));
      for (const index of indexes) Object.assign(tableRows(table)[index], patch);
      return query;
    },
    then(resolve: (value: unknown) => void) {
      resolve({ data: indexes.map((index) => tableRows(table)[index]), error: null });
    },
  };
  return query;
}

function makeUpsert(table: keyof typeof tables, input: Row | Row[]) {
  const incoming = Array.isArray(input) ? input : [input];
  const rows = tableRows(table);
  for (const row of incoming) {
    const index = rows.findIndex((item) =>
      item.id === row.id
      || (item.booking_id === row.booking_id && item.provider === row.provider));
    if (index >= 0) rows[index] = { ...rows[index], ...row };
    else rows.push(row);
  }
  return {
    then(resolve: (value: unknown) => void) {
      resolve({ data: incoming, error: null });
    },
  };
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: keyof typeof tables) => ({
      select: vi.fn(() => makeSelect(table)),
      insert: vi.fn((input: Row | Row[]) => {
        tableRows(table).push(...(Array.isArray(input) ? input : [input]));
        return {
          then(resolve: (value: unknown) => void) {
            resolve({ data: input, error: null });
          },
        };
      }),
      update: vi.fn((patch: Row) => makeUpdate(table, patch)),
      upsert: vi.fn((input: Row | Row[]) => makeUpsert(table, input)),
    })),
  },
}));

vi.mock('../repository', () => ({
  getBookingOpsRecord: vi.fn(async () => record),
  updateBookingOpsRecord,
}));

vi.mock('../lifecycle', () => ({
  initializeLifecycleForBooking: vi.fn(async (bookingId: string) => {
    lifecycle.initialized.push(bookingId);
    return { ok: true, gates: [] };
  }),
  completeGate: vi.fn(async (bookingId: string, gateKey: string, metadata?: Record<string, unknown>) => {
    lifecycle.completed.push({ bookingId, gateKey, metadata });
    return { ok: true };
  }),
  blockGate: vi.fn(async (bookingId: string, gateKey: string, reason: string) => {
    lifecycle.blocked.push({ bookingId, gateKey, reason });
    return { ok: true };
  }),
  markGateInProgress: vi.fn(async (bookingId: string, gateKey: string) => {
    lifecycle.inProgress.push({ bookingId, gateKey });
    return { ok: true };
  }),
  getLifecycleStatus: vi.fn(async () => ({
    ok: true,
    lifecycle: {
      bookingId: record.id,
      gates: [
        { gateKey: 'documents_verified', status: 'completed' },
        { gateKey: 'contract_signed', status: 'completed' },
        { gateKey: 'deposit_received', status: 'completed' },
        { gateKey: 'mvd_report_submitted', status: 'completed' },
      ],
      readinessScore: 100,
      currentActiveGate: null,
      blockedGates: [],
      completedGates: [],
      nextRequiredGates: [],
      exceptions: [],
    },
  })),
}));

describe('Guest Legal & Payment Autopilot v1', () => {
  beforeEach(() => {
    tables.booking_guest_documents = [];
    tables.booking_contracts = [];
    tables.booking_deposits = [];
    tables.booking_mvd_reports = [];
    tables.booking_ops_communication_intents = [];
    lifecycle.initialized = [];
    lifecycle.completed = [];
    lifecycle.blocked = [];
    lifecycle.inProgress = [];
    updateBookingOpsRecord.mockClear();
  });

  it('initializes legal/payment placeholders for booking', async () => {
    const { initializeLegalPaymentForBooking } = await import('../legal-payment-autopilot');

    const status = await initializeLegalPaymentForBooking(record.id);

    expect(status.bookingId).toBe(record.id);
    expect(tables.booking_contracts[0]).toMatchObject({ booking_id: record.id, status: 'not_started' });
    expect(tables.booking_deposits[0]).toMatchObject({ booking_id: record.id, status: 'not_requested' });
    expect(tables.booking_mvd_reports[0]).toMatchObject({ booking_id: record.id, status: 'not_started' });
  });

  it('request documents creates a communication draft and completes documents_requested', async () => {
    const { requestGuestDocuments } = await import('../legal-payment-autopilot');

    await requestGuestDocuments(record.id, ['passport']);

    expect(tables.booking_guest_documents).toHaveLength(1);
    expect(lifecycle.completed.map((item) => item.gateKey)).toContain('documents_requested');
    expect(tables.booking_ops_communication_intents[0]).toMatchObject({
      purpose: 'request_guest_documents',
      status: 'draft_ready',
    });
  });

  it('verify documents completes received and verified gates', async () => {
    const { requestGuestDocuments, markDocumentsReceived, verifyGuestDocuments } = await import('../legal-payment-autopilot');

    await requestGuestDocuments(record.id, ['passport']);
    await markDocumentsReceived(record.id);
    await verifyGuestDocuments(record.id);

    expect(lifecycle.completed.map((item) => item.gateKey)).toEqual(
      expect.arrayContaining(['documents_received', 'documents_verified']),
    );
    expect(updateBookingOpsRecord).toHaveBeenCalledWith(
      record.id,
      expect.objectContaining({ documentsStatus: 'verified' }),
      expect.any(Object),
    );
  });

  it('prepare and sign contract complete contract gates', async () => {
    const { prepareContract, markContractSent, markContractSigned } = await import('../legal-payment-autopilot');

    await prepareContract(record.id, 'default');
    await markContractSent(record.id);
    await markContractSigned(record.id);

    expect(lifecycle.completed.map((item) => item.gateKey)).toEqual(
      expect.arrayContaining(['contract_prepared', 'contract_sent', 'contract_signed']),
    );
    expect(tables.booking_ops_communication_intents[0]).toMatchObject({
      purpose: 'request_contract_confirmation',
    });
  });

  it('request and receive deposit complete deposit gates', async () => {
    const { requestDeposit, markDepositReceived } = await import('../legal-payment-autopilot');

    await requestDeposit(record.id, 5000, 'RUB');
    await markDepositReceived(record.id);

    expect(lifecycle.completed.map((item) => item.gateKey)).toEqual(
      expect.arrayContaining(['deposit_requested', 'deposit_received']),
    );
  });

  it('prepare and submit report complete МВД gates', async () => {
    const { prepareMvdReport, markMvdReportSubmitted } = await import('../legal-payment-autopilot');

    await prepareMvdReport(record.id);
    await markMvdReportSubmitted(record.id);

    expect(lifecycle.completed.map((item) => item.gateKey)).toEqual(
      expect.arrayContaining(['mvd_report_prepared', 'mvd_report_submitted']),
    );
  });

  it('rejected documents create blocker and fallback exception path', async () => {
    const { requestGuestDocuments, rejectGuestDocuments, getLegalPaymentBlockers } = await import('../legal-payment-autopilot');

    await requestGuestDocuments(record.id, ['passport']);
    await rejectGuestDocuments(record.id, 'Плохое фото');

    expect(lifecycle.blocked[0]).toMatchObject({
      gateKey: 'documents_verified',
      reason: 'Плохое фото',
    });
    await expect(getLegalPaymentBlockers(record.id)).resolves.toEqual([
      { gateKey: 'documents_verified', reason: 'Документы отклонены' },
    ]);
  });

  it('normal pending status does not create fallback', async () => {
    const { requestGuestDocuments } = await import('../legal-payment-autopilot');

    await requestGuestDocuments(record.id, ['passport']);

    expect(lifecycle.blocked).toHaveLength(0);
  });
});
