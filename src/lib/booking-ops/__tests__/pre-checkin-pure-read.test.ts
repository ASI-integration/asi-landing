import { beforeEach, describe, expect, it, vi } from 'vitest';

const BOOKING_ID = 'ops-read';
const FRESH = '2026-10-03T01:30:00.000Z';
const STALE = '2026-10-03T01:20:00.000Z';

const state = {
  legalAt: FRESH,
  physicalAt: FRESH,
};

const requiredGates = [
  'guest_data_completed',
  'documents_verified',
  'contract_signed',
  'deposit_received',
  'mvd_report_submitted',
  'cleaning_scheduled',
  'linen_scheduled',
  'inspection_scheduled',
  'property_ready',
  'checkin_instructions_sent',
];

vi.mock('../repository', () => ({
  getBookingOpsRecord: vi.fn(async () => ({
    id: BOOKING_ID,
    updatedAt: FRESH,
    manualNextAction: null,
  })),
  listBookingOpsRecords: vi.fn(async () => ({ ok: true, records: [] })),
  updateBookingOpsRecord: vi.fn(),
}));

vi.mock('../lifecycle', () => ({
  adminUpdateLifecycleGate: vi.fn(),
  blockGate: vi.fn(),
  completeGate: vi.fn(),
  getLifecycleStatus: vi.fn(),
  initializeLifecycleForBooking: vi.fn(),
  readLifecycleStatus: vi.fn(async () => ({
    ok: true,
    lifecycle: {
      bookingId: BOOKING_ID,
      gates: requiredGates.map((gateKey) => ({
        id: gateKey,
        bookingId: BOOKING_ID,
        gateKey,
        status: 'completed',
        source: 'system',
        updatedAt: FRESH,
        completedAt: FRESH,
        reason: null,
        note: null,
        metadata: {},
      })),
      readinessScore: 100,
      currentActiveGate: null,
      blockedGates: [],
      completedGates: [],
      nextRequiredGates: [],
      exceptions: [],
    },
  })),
}));
vi.mock('../tasks', () => ({
  listBookingOpsTasksForRecord: vi.fn(async () => ({ ok: true, tasks: [] })),
}));

vi.mock('../guest-legal-deposit-mvd-execution', () => ({
  getGuestLegalReadiness: vi.fn(async () => ({
    bookingId: BOOKING_ID,
    status: 'ready_for_checkin',
    blockers: [],
    warnings: [],
    lastCheckedAt: state.legalAt,
    updatedAt: state.legalAt,
  })),
}));

vi.mock('../physical-readiness-execution', () => ({
  readPhysicalReadiness: vi.fn(async () => ({
    bookingId: BOOKING_ID,
    propertyId: 'property-1',
    status: 'approved',
    blockers: [],
    operationalBlockers: [],
    finalReady: true,
    updatedAt: state.physicalAt,
  })),
}));

const writes = { insert: vi.fn(), update: vi.fn(), upsert: vi.fn(), delete: vi.fn() };
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(async () => ({ data: [], error: null })),
        })),
      })),
      insert: writes.insert,
      update: writes.update,
      upsert: writes.upsert,
      delete: writes.delete,
    })),
  },
}));

describe('pre-check-in pure read', () => {
  beforeEach(() => {
    state.legalAt = FRESH;
    state.physicalAt = FRESH;
    vi.clearAllMocks();
  });

  it('builds current readiness from persisted domain state without writes', async () => {
    const { readPreCheckinStatus } = await import('../pre-checkin-control-center');

    const result = await readPreCheckinStatus(BOOKING_ID);

    expect(result).toMatchObject({
      bookingId: BOOKING_ID,
      status: 'ready_for_checkin',
      lastRecomputedAt: FRESH,
      metadata: { readMode: 'persisted_current_state' },
    });
    expect(writes.insert).not.toHaveBeenCalled();
    expect(writes.update).not.toHaveBeenCalled();
    expect(writes.upsert).not.toHaveBeenCalled();
    expect(writes.delete).not.toHaveBeenCalled();
  });

  it('passes canonical account scope into the readiness list repository query', async () => {
    const repository = await import('../repository');
    const { listBookingsByReadinessStatus } = await import('../pre-checkin-control-center');

    await listBookingsByReadinessStatus({ accountId: 'account-a', limit: 25 });

    expect(repository.listBookingOpsRecords).toHaveBeenCalledWith({
      accountId: 'account-a',
      limit: 25,
    });
  });

  it('uses the oldest required domain observation so stale physical state fails freshness', async () => {
    state.physicalAt = STALE;
    const { readPreCheckinStatus } = await import('../pre-checkin-control-center');

    const result = await readPreCheckinStatus(BOOKING_ID);

    expect(result.lastRecomputedAt).toBe(STALE);
  });

  it('uses the oldest required domain observation so stale legal state fails freshness', async () => {
    state.legalAt = STALE;
    const { readPreCheckinStatus } = await import('../pre-checkin-control-center');

    const result = await readPreCheckinStatus(BOOKING_ID);

    expect(result.lastRecomputedAt).toBe(STALE);
  });
});
