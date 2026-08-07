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
} = vi.hoisted(() => ({
  supabaseFrom: vi.fn(),
  recordBookingOpsEvent: vi.fn(async () => undefined),
  applyBookingOpsTaskSync: vi.fn(async () => undefined),
  syncLifecycleFromBookingOpsRecord: vi.fn(async () => undefined),
  syncGuestIntakeAutopilot: vi.fn(async () => ({ session: null })),
  getGuestIntakeSessionForRecord: vi.fn(async () => null),
  lookupPropertyKnowledge: vi.fn(async () => ({ knowledge: null, match: null })),
  fetchTelegramDraftStatusesForRecord: vi.fn(async () => []),
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
vi.mock('../channel-manager-live-core-acceptance-context', () => ({
  resolveAcceptanceReservationMetadataForCreate: vi.fn(() => ({})),
}));

import { updateBookingOpsRecord } from '../repository';

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
    syncLifecycleFromBookingOpsRecord.mockClear();
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
});
