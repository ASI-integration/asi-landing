import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;
const BOOKING_ID = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-10-03T01:30:00.000Z';

const tables: Record<string, Row[]> = {};
const writes = {
  insert: vi.fn(),
  update: vi.fn(),
  upsert: vi.fn(),
};

function queryRows(table: string) {
  let result = [...(tables[table] ?? [])];
  const query = {
    eq(column: string, value: unknown) {
      result = result.filter((row) => row[column] === value);
      return query;
    },
    maybeSingle: vi.fn(async () => ({ data: result[0] ?? null, error: null })),
    order: vi.fn(async () => ({ data: result, error: null })),
  };
  return query;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => queryRows(table)),
      insert: writes.insert,
      update: writes.update,
      upsert: writes.upsert,
    })),
  },
}));

vi.mock('../repository', () => ({
  getBookingOpsRecord: vi.fn(async () => ({
    id: BOOKING_ID,
    propertyId: 'property-1',
  })),
}));

describe('physical readiness pure read', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(tables).forEach((key) => delete tables[key]);
    tables.booking_cleaning_tasks = [{
      id: 'cleaning-1', booking_id: BOOKING_ID, property_id: 'property-1',
      status: 'verified', report_payload: {}, created_at: NOW, updated_at: NOW,
    }];
    tables.booking_linen_tasks = [{
      id: 'linen-1', booking_id: BOOKING_ID, property_id: 'property-1',
      status: 'verified', report_payload: {}, created_at: NOW, updated_at: NOW,
    }];
    tables.booking_supplies_tasks = [{
      id: 'supplies-1', booking_id: BOOKING_ID, property_id: 'property-1',
      status: 'verified', report_payload: {}, created_at: NOW, updated_at: NOW,
    }];
    tables.booking_maintenance_tickets = [];
    tables.booking_physical_coordination_drafts = [];
    tables.booking_physical_readiness = [{
      id: 'readiness-1', booking_id: BOOKING_ID, property_id: 'property-1',
      status: 'approved', blockers: [], final_ready: true,
      approved_at: NOW, approved_by: 'operator-1', metadata: {},
      created_at: NOW, updated_at: NOW,
    }];
  });

  it('derives the current physical snapshot without writes', async () => {
    const { getPhysicalReadiness, readPhysicalReadiness } = await import('../physical-readiness-execution');

    const direct = await readPhysicalReadiness(BOOKING_ID);
    const publicRead = await getPhysicalReadiness(BOOKING_ID);

    expect(direct).toMatchObject({
      bookingId: BOOKING_ID,
      propertyId: 'property-1',
      status: 'approved',
      finalReady: true,
      blockers: [],
      updatedAt: NOW,
    });
    expect(publicRead).toEqual(direct);
    expect(writes.insert).not.toHaveBeenCalled();
    expect(writes.update).not.toHaveBeenCalled();
    expect(writes.upsert).not.toHaveBeenCalled();
  });

  it('fails closed to null when persisted readiness was never initialized', async () => {
    tables.booking_physical_readiness = [];
    const { readPhysicalReadiness } = await import('../physical-readiness-execution');

    await expect(readPhysicalReadiness(BOOKING_ID)).resolves.toBeNull();
    expect(writes.insert).not.toHaveBeenCalled();
    expect(writes.update).not.toHaveBeenCalled();
    expect(writes.upsert).not.toHaveBeenCalled();
  });

  it('does not let a newer readiness row mask an older physical task observation', async () => {
    tables.booking_cleaning_tasks[0].updated_at = '2026-10-03T01:20:00.000Z';
    const { readPhysicalReadiness } = await import('../physical-readiness-execution');

    const result = await readPhysicalReadiness(BOOKING_ID);

    expect(result?.updatedAt).toBe('2026-10-03T01:20:00.000Z');
  });

  it('invalidates stale approval in memory without persisting the change', async () => {
    tables.booking_cleaning_tasks[0].status = 'completed';
    const { readPhysicalReadiness } = await import('../physical-readiness-execution');

    const result = await readPhysicalReadiness(BOOKING_ID);

    expect(result).toMatchObject({ status: 'blocked', finalReady: false, approvedAt: null });
    expect(result?.blockers.map((item) => item.key)).toContain('cleaning_not_verified');
    expect(writes.update).not.toHaveBeenCalled();
    expect(writes.upsert).not.toHaveBeenCalled();
  });
});
