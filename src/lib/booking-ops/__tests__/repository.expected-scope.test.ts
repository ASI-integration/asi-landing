import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

const {
  supabaseFrom,
  recordBookingOpsEvent,
  applyBookingOpsTaskSync,
  syncLifecycleFromBookingOpsRecord,
  syncGuestIntakeAutopilot,
  getGuestIntakeSessionForRecord,
  lookupPropertyKnowledge,
  fetchTelegramDraftStatusesForRecord,
  requireBookingOpsPropertyAccountScope,
} = vi.hoisted(() => ({
  supabaseFrom: vi.fn(),
  recordBookingOpsEvent: vi.fn(async () => undefined),
  applyBookingOpsTaskSync: vi.fn(async () => undefined),
  syncLifecycleFromBookingOpsRecord: vi.fn(async () => undefined),
  syncGuestIntakeAutopilot: vi.fn(async () => ({ session: null })),
  getGuestIntakeSessionForRecord: vi.fn(async () => null),
  lookupPropertyKnowledge: vi.fn(async () => ({ knowledge: null, match: null })),
  fetchTelegramDraftStatusesForRecord: vi.fn(async () => []),
  requireBookingOpsPropertyAccountScope: vi.fn(async (accountId: string, propertyId: string) => ({ accountId, propertyId })),
}));

const tables: Record<string, Row[]> = {};
function rows(table: string): Row[] {
  return tables[table] ?? (tables[table] = []);
}

class Query {
  private filtered: Row[];
  constructor(
    private table: string,
    private options: { patch?: Row } = {},
  ) {
    this.filtered = [...rows(table)];
  }

  eq(column: string, value: unknown) {
    this.filtered = this.filtered.filter((row) => row[column] === value);
    return this;
  }

  is(column: string, value: unknown) {
    this.filtered = this.filtered.filter((row) => row[column] === value);
    return this;
  }

  select() {
    return this;
  }

  private execute() {
    if (this.options.patch) {
      for (const row of this.filtered) Object.assign(row, this.options.patch);
    }
    return {
      data: this.filtered.map((row) => ({ ...row })),
      error: null,
    };
  }

  async maybeSingle() {
    const result = this.execute();
    return { data: result.data?.[0] ?? null, error: null };
  }

  then(resolve: (value: ReturnType<Query['execute']>) => void) {
    resolve(this.execute());
  }
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => supabaseFrom(...args),
  },
}));
vi.mock('../events', () => ({ recordBookingOpsEvent }));
vi.mock('../tasks', () => ({ applyBookingOpsTaskSync }));
vi.mock('../lifecycle', () => ({ syncLifecycleFromBookingOpsRecord }));
vi.mock('../guest-intake-autopilot', () => ({
  getGuestIntakeSessionForRecord,
  getGuestIntakeSessionsForRecords: vi.fn(async () => []),
  syncGuestIntakeAutopilot,
}));
vi.mock('../property-knowledge', () => ({
  lookupPropertyKnowledge,
  lookupPropertyKnowledgeBatch: vi.fn(async () => new Map()),
}));
vi.mock('../readiness', () => ({
  attachBookingReadiness: (record: Row) => record,
  fetchTelegramDraftStatusesForRecord,
}));
vi.mock('../alerts', () => ({
  attachBookingOpsAlerts: (record: Row) => record,
}));
vi.mock('../core-loop-initialization', () => ({
  initializeBookingOpsCoreLoop: vi.fn(async () => undefined),
}));
vi.mock('../route-access', () => ({ requireBookingOpsPropertyAccountScope }));
vi.mock('../channel-manager-live-core-acceptance-context', () => ({
  resolveAcceptanceReservationMetadataForCreate: vi.fn(() => ({})),
}));

import {
  attachBookingOpsRecordProperty,
  updateBookingOpsRecord,
  updateUnboundBookingOpsReviewData,
} from '../repository';

const RECORD_ID = '30000000-0000-4000-8000-000000000003';
const ACCOUNT_A = 'account-a';
const PROPERTY_A = 'prop-a';

function seedRecord(patch: Row = {}) {
  const row = {
    id: RECORD_ID,
    account_id: ACCOUNT_A,
    property_id: PROPERTY_A,
    booking_id: 'book-1',
    guest_name: 'Анна',
    guest_count: 2,
    check_in_at: '2026-07-10T00:00:00.000Z',
    check_out_at: '2026-07-12T00:00:00.000Z',
    ops_status: 'new',
    documents_status: 'not_required',
    contract_status: 'not_required',
    deposit_status: 'not_required',
    mvd_status: 'not_required',
    checkin_readiness_status: 'not_ready',
    unit_readiness_status: 'unknown',
    is_blocked: false,
    blocker_reason: null,
    manual_next_action: null,
    notes: null,
    created_at: '2026-08-07T10:00:00.000Z',
    updated_at: '2026-08-07T10:00:00.000Z',
    ...patch,
  };
  rows('booking_ops_records').push(row);
  return row;
}

describe('updateBookingOpsRecord expectedScope', () => {
  beforeEach(() => {
    for (const key of Object.keys(tables)) tables[key] = [];
    recordBookingOpsEvent.mockClear();
    applyBookingOpsTaskSync.mockClear();
    syncGuestIntakeAutopilot.mockClear();
    syncLifecycleFromBookingOpsRecord.mockClear();
    requireBookingOpsPropertyAccountScope.mockClear();
    requireBookingOpsPropertyAccountScope.mockImplementation(async (accountId: string, propertyId: string) => ({
      accountId,
      propertyId,
    }));
    supabaseFrom.mockImplementation((table: string) => ({
      select: vi.fn(() => new Query(table)),
      update: vi.fn((patch: Row) => new Query(table, { patch })),
    }));
  });

  it('updates when id + account + property match expectedScope', async () => {
    seedRecord({ guest_count: 2 });
    const result = await updateBookingOpsRecord(
      RECORD_ID,
      { guestCount: 5 },
      {
        actorType: 'admin',
        expectedScope: { accountId: ACCOUNT_A, propertyId: PROPERTY_A },
      },
    );
    expect(result.ok).toBe(true);
    expect(rows('booking_ops_records')[0]?.guest_count).toBe(5);
    expect(recordBookingOpsEvent).toHaveBeenCalled();
    expect(applyBookingOpsTaskSync).toHaveBeenCalled();
    expect(syncLifecycleFromBookingOpsRecord).toHaveBeenCalled();
  });

  it('TOCTOU: zero-row scoped UPDATE returns scope_mismatch without side effects', async () => {
    const record = seedRecord({ guest_count: 2 });
    let selectCount = 0;
    supabaseFrom.mockImplementation((table: string) => ({
      select: vi.fn(() => {
        selectCount += 1;
        if (selectCount === 1) {
          // First SELECT (previous) still sees contour A.
          return new Query(table);
        }
        return new Query(table);
      }),
      update: vi.fn((patch: Row) => {
        // Immediately before UPDATE the booking moves to another contour.
        record.account_id = 'account-b';
        record.property_id = 'prop-b';
        return new Query(table, { patch });
      }),
    }));

    const result = await updateBookingOpsRecord(
      RECORD_ID,
      { guestCount: 8 },
      {
        actorType: 'admin',
        expectedScope: { accountId: ACCOUNT_A, propertyId: PROPERTY_A },
      },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe('scope_mismatch');
    expect(record.guest_count).toBe(2);
    expect(record.account_id).toBe('account-b');
    expect(record.property_id).toBe('prop-b');
    expect(recordBookingOpsEvent).not.toHaveBeenCalled();
    expect(applyBookingOpsTaskSync).not.toHaveBeenCalled();
    expect(syncLifecycleFromBookingOpsRecord).not.toHaveBeenCalled();
  });

  it('callers without expectedScope keep id-only behavior', async () => {
    seedRecord({ guest_count: 2, account_id: 'anywhere', property_id: 'anywhere' });
    const result = await updateBookingOpsRecord(RECORD_ID, { guestCount: 3 }, { actorType: 'system' });
    expect(result.ok).toBe(true);
    expect(rows('booking_ops_records')[0]?.guest_count).toBe(3);
  });

  it('attaches a canonical property only to an account-bound currently-unbound record', async () => {
    const record = seedRecord({ property_id: null, property_label: null });
    const result = await attachBookingOpsRecordProperty(
      RECORD_ID,
      { accountId: ACCOUNT_A, propertyId: 'prop-b', propertyLabel: 'Unit B' },
      { actorType: 'admin' },
    );

    expect(result.ok).toBe(true);
    expect(record.property_id).toBe('prop-b');
    expect((record as Row).property_label).toBe('Unit B');
    expect(requireBookingOpsPropertyAccountScope).toHaveBeenCalledTimes(2);
    expect(requireBookingOpsPropertyAccountScope).toHaveBeenNthCalledWith(1, ACCOUNT_A, 'prop-b');
    expect(requireBookingOpsPropertyAccountScope).toHaveBeenNthCalledWith(2, ACCOUNT_A, 'prop-b');
    expect(applyBookingOpsTaskSync).toHaveBeenCalledWith(
      expect.objectContaining({ id: RECORD_ID, accountId: ACCOUNT_A, propertyId: 'prop-b' }),
      { accountId: ACCOUNT_A, propertyId: 'prop-b' },
    );
    expect(syncGuestIntakeAutopilot).toHaveBeenCalledWith(
      expect.objectContaining({ id: RECORD_ID, propertyId: 'prop-b' }),
      { accountId: ACCOUNT_A, propertyId: 'prop-b' },
    );
    expect(syncLifecycleFromBookingOpsRecord).toHaveBeenCalledWith(
      expect.objectContaining({ id: RECORD_ID, propertyId: 'prop-b' }),
      { accountId: ACCOUNT_A, propertyId: 'prop-b' },
    );
  });

  it('fails closed if booking ownership changes before the unbound attach UPDATE', async () => {
    const record = seedRecord({ property_id: null, property_label: null });
    supabaseFrom.mockImplementation((table: string) => ({
      select: vi.fn(() => new Query(table)),
      update: vi.fn((patch: Row) => {
        record.account_id = 'account-b';
        return new Query(table, { patch });
      }),
    }));

    const result = await attachBookingOpsRecordProperty(RECORD_ID, {
      accountId: ACCOUNT_A,
      propertyId: 'prop-b',
    });

    expect(result).toMatchObject({ ok: false, error: 'scope_mismatch' });
    expect(record.account_id).toBe('account-b');
    expect(record.property_id).toBeNull();
    expect(recordBookingOpsEvent).not.toHaveBeenCalled();
    expect(applyBookingOpsTaskSync).not.toHaveBeenCalled();
    expect(syncGuestIntakeAutopilot).not.toHaveBeenCalled();
    expect(syncLifecycleFromBookingOpsRecord).not.toHaveBeenCalled();
  });

  it('rejects a property outside the canonical account before touching the booking', async () => {
    const record = seedRecord({ property_id: null, property_label: null });
    requireBookingOpsPropertyAccountScope.mockRejectedValueOnce(new Error('property_scope_mismatch'));

    const result = await attachBookingOpsRecordProperty(RECORD_ID, {
      accountId: ACCOUNT_A,
      propertyId: 'foreign-prop',
    });

    expect(result).toMatchObject({ ok: false, error: 'property_scope_mismatch' });
    expect(record.property_id).toBeNull();
    expect(recordBookingOpsEvent).not.toHaveBeenCalled();
    expect(applyBookingOpsTaskSync).not.toHaveBeenCalled();
    expect(syncGuestIntakeAutopilot).not.toHaveBeenCalled();
    expect(syncLifecycleFromBookingOpsRecord).not.toHaveBeenCalled();
  });

  it('updates guest data on an account-owned unbound review without starting automation', async () => {
    const record = seedRecord({
      property_id: null,
      guest_name: 'Анна',
      guest_phone: null,
      guest_email: null,
    });

    const result = await updateUnboundBookingOpsReviewData(
      RECORD_ID,
      { guestPhone: '+79990000001', guestEmail: 'anna@example.test' },
      ACCOUNT_A,
    );

    expect(result.ok).toBe(true);
    expect((record as Row).guest_phone).toBe('+79990000001');
    expect((record as Row).guest_email).toBe('anna@example.test');
    expect(record.property_id).toBeNull();
    expect(recordBookingOpsEvent).not.toHaveBeenCalled();
    expect(applyBookingOpsTaskSync).not.toHaveBeenCalled();
    expect(syncGuestIntakeAutopilot).not.toHaveBeenCalled();
    expect(syncLifecycleFromBookingOpsRecord).not.toHaveBeenCalled();
  });

  it('rejects unbound review data updates from the wrong account', async () => {
    const record = seedRecord({
      property_id: null,
      guest_phone: null,
    });

    const result = await updateUnboundBookingOpsReviewData(
      RECORD_ID,
      { guestPhone: '+79990000002' },
      'account-b',
    );

    expect(result).toMatchObject({ ok: false, error: 'scope_mismatch' });
    expect((record as Row).guest_phone).toBeNull();
    expect(recordBookingOpsEvent).not.toHaveBeenCalled();
    expect(applyBookingOpsTaskSync).not.toHaveBeenCalled();
    expect(syncGuestIntakeAutopilot).not.toHaveBeenCalled();
    expect(syncLifecycleFromBookingOpsRecord).not.toHaveBeenCalled();
  });

  it('fails closed if an unbound review becomes property-bound before the data UPDATE', async () => {
    const record = seedRecord({
      property_id: null,
      guest_phone: null,
    });
    supabaseFrom.mockImplementation((table: string) => ({
      select: vi.fn(() => new Query(table)),
      update: vi.fn((patch: Row) => {
        record.property_id = PROPERTY_A;
        return new Query(table, { patch });
      }),
    }));

    const result = await updateUnboundBookingOpsReviewData(
      RECORD_ID,
      { guestPhone: '+79990000003' },
      ACCOUNT_A,
    );

    expect(result).toMatchObject({ ok: false, error: 'scope_mismatch' });
    expect(record.property_id).toBe(PROPERTY_A);
    expect((record as Row).guest_phone).toBeNull();
    expect(recordBookingOpsEvent).not.toHaveBeenCalled();
    expect(applyBookingOpsTaskSync).not.toHaveBeenCalled();
    expect(syncGuestIntakeAutopilot).not.toHaveBeenCalled();
    expect(syncLifecycleFromBookingOpsRecord).not.toHaveBeenCalled();
  });
});
