import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

const tables = {
  booking_lifecycle_gates: [] as Row[],
  booking_lifecycle_exceptions: [] as Row[],
};

function rowsFor(table: keyof typeof tables): Row[] {
  return tables[table];
}

function makeThenable(value: unknown) {
  return {
    then(resolve: (value: unknown) => void) {
      resolve(value);
    },
  };
}

function selectQuery(table: keyof typeof tables) {
  let result = [...rowsFor(table)];
  const query = {
    eq(column: string, value: unknown) {
      result = result.filter((row) => row[column] === value);
      return query;
    },
    order() {
      return makeThenable({ data: result, error: null });
    },
    then(resolve: (value: unknown) => void) {
      resolve({ data: result, error: null });
    },
  };
  return query;
}

function upsertQuery(
  table: keyof typeof tables,
  input: Row | Row[],
  options?: { ignoreDuplicates?: boolean },
) {
  const incoming = Array.isArray(input) ? input : [input];
  const rows = rowsFor(table);
  for (const row of incoming) {
    const index = rows.findIndex((item) =>
      item.booking_id === row.booking_id && item.gate_key === row.gate_key);
    if (index >= 0 && !options?.ignoreDuplicates) rows[index] = { ...rows[index], ...row };
    if (index < 0) rows.push(row);
  }
  return {
    error: null,
    select() {
      return {
        single: vi.fn(async () => ({ data: incoming[incoming.length - 1], error: null })),
      };
    },
    then(resolve: (value: unknown) => void) {
      resolve({ data: incoming, error: null });
    },
  };
}

function updateQuery(table: keyof typeof tables, patch: Row) {
  let result = rowsFor(table);
  const query = {
    eq(column: string, value: unknown) {
      result = result.filter((row) => row[column] === value);
      for (const row of result) Object.assign(row, patch);
      return query;
    },
    then(resolve: (value: unknown) => void) {
      resolve({ data: result, error: null });
    },
  };
  return query;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: keyof typeof tables) => ({
      select: vi.fn(() => selectQuery(table)),
      upsert: vi.fn((input: Row | Row[], options?: { ignoreDuplicates?: boolean }) =>
        upsertQuery(table, input, options)),
      update: vi.fn((patch: Row) => updateQuery(table, patch)),
    })),
  },
}));

describe('Booking Lifecycle Gates v1', () => {
  beforeEach(() => {
    tables.booking_lifecycle_gates = [];
    tables.booking_lifecycle_exceptions = [];
  });

  it('initializes all gates for a new booking', async () => {
    const { BOOKING_LIFECYCLE_GATE_KEYS, initializeLifecycleForBooking } = await import('../lifecycle');

    const result = await initializeLifecycleForBooking('ops-1');

    expect(result.ok).toBe(true);
    expect(result.gates).toHaveLength(BOOKING_LIFECYCLE_GATE_KEYS.length);
    expect(result.gates?.[0]).toMatchObject({
      bookingId: 'ops-1',
      gateKey: 'booking_received',
      status: 'completed',
    });
  });

  it('completes gates and updates readiness score', async () => {
    const {
      completeGate,
      getBookingReadinessScore,
      getLifecycleStatus,
    } = await import('../lifecycle');

    await completeGate('ops-2', 'guest_data_completed');
    await completeGate('ops-2', 'documents_received');

    const status = await getLifecycleStatus('ops-2');
    expect(status.lifecycle?.completedGates.map((gate) => gate.gateKey)).toContain('documents_received');
    expect(await getBookingReadinessScore('ops-2')).toBe(12);
  });

  it('blocked gates appear in fallback exception list', async () => {
    const { blockGate, getBlockedGates, getLifecycleStatus } = await import('../lifecycle');

    await blockGate('ops-3', 'documents_verified', 'Документ не читается');

    const blocked = await getBlockedGates('ops-3');
    const status = await getLifecycleStatus('ops-3');
    expect(blocked).toHaveLength(1);
    expect(status.lifecycle?.exceptions).toHaveLength(1);
    expect(status.lifecycle?.exceptions[0]).toMatchObject({
      gateKey: 'documents_verified',
      reason: 'Документ не читается',
    });
  });

  it('placeholder provider-ready gates can be manually completed', async () => {
    const { adminUpdateLifecycleGate, getLifecycleStatus } = await import('../lifecycle');

    await adminUpdateLifecycleGate({
      bookingId: 'ops-4',
      gateKey: 'contract_prepared',
      status: 'completed',
      note: 'Ручная подготовка',
    });
    await adminUpdateLifecycleGate({
      bookingId: 'ops-4',
      gateKey: 'deposit_received',
      status: 'completed',
    });
    await adminUpdateLifecycleGate({
      bookingId: 'ops-4',
      gateKey: 'mvd_report_submitted',
      status: 'completed',
    });

    const status = await getLifecycleStatus('ops-4');
    expect(status.lifecycle?.completedGates.map((gate) => gate.gateKey)).toEqual(
      expect.arrayContaining(['contract_prepared', 'deposit_received', 'mvd_report_submitted']),
    );
  });
});
