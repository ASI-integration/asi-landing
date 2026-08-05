import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

const { supabaseFrom } = vi.hoisted(() => ({
  supabaseFrom: vi.fn(),
}));

const tables: Record<string, Row[]> = {};
function rows(table: string): Row[] {
  return tables[table] ?? (tables[table] = []);
}

class Query {
  private filtered: Row[];
  constructor(private table: string, private options: { patch?: Row; count?: boolean; head?: boolean } = {}) {
    this.filtered = [...rows(table)];
  }
  eq(column: string, value: unknown) {
    this.filtered = this.filtered.filter((row) => row[column] === value);
    return this;
  }
  neq(column: string, value: unknown) {
    this.filtered = this.filtered.filter((row) => row[column] !== value);
    return this;
  }
  gte(column: string, value: unknown) {
    this.filtered = this.filtered.filter((row) => String(row[column] ?? '') >= String(value));
    return this;
  }
  lte(column: string, value: unknown) {
    this.filtered = this.filtered.filter((row) => String(row[column] ?? '') <= String(value));
    return this;
  }
  lt(column: string, value: unknown) {
    this.filtered = this.filtered.filter((row) => String(row[column] ?? '') < String(value));
    return this;
  }
  gt(column: string, value: unknown) {
    this.filtered = this.filtered.filter((row) => String(row[column] ?? '') > String(value));
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filtered = this.filtered.filter((row) => values.includes(row[column]));
    return this;
  }
  or() { return this; }
  order() { return this; }
  limit(value: number) {
    this.filtered = this.filtered.slice(0, value);
    return this;
  }
  select(_columns = '*', options?: { count?: string; head?: boolean }) {
    if (options) this.options = { ...this.options, count: Boolean(options.count), head: options.head };
    return this;
  }
  private execute() {
    if (this.options.patch) for (const row of this.filtered) Object.assign(row, this.options.patch);
    return {
      data: this.options.head ? null : this.filtered,
      error: null,
      count: this.options.count ? this.filtered.length : null,
    };
  }
  async single() {
    const result = this.execute();
    return { data: result.data?.[0] ?? null, error: result.data?.[0] ? null : { message: 'not found' } };
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
    rpc: vi.fn(),
  },
}));

import {
  auditChannelImportAvailability,
  checkAvailabilityConflict,
  classifyAvailabilityConflicts,
  collapseChannelCalendarConflicts,
  isChannelCalendarDateCoveredByImportedBooking,
  isConfirmationLikeCommunication,
  normalizeAvailabilityDate,
  rangesOverlap,
  type AvailabilityConflict,
} from '../availability-overbooking-protection';

const conflict = (
  type: AvailabilityConflict['type'],
  severity: AvailabilityConflict['severity'],
): AvailabilityConflict => ({ type, severity, id: `${type}-1` });

const CONNECTION_ID = '90000000-0000-4000-8000-000000000009';
const PROPERTY_SETUP_ID = '20000000-0000-4000-8000-000000000002';
const BOOKING_OPS_ID = '30000000-0000-4000-8000-000000000003';
const IMPORTED_BOOKING_ID = '40000000-0000-4000-8000-000000000004';
const OTHER_IMPORTED_BOOKING_ID = '40000000-0000-4000-8000-000000000005';
const OTHER_BOOKING_OPS_ID = '30000000-0000-4000-8000-000000000006';

function seedSelfBookingScenario(options?: {
  matchedBookingId?: string | null;
  extraImported?: Row;
  extraCalendar?: Row[];
  extraOpsBooking?: Row;
}) {
  rows('booking_channel_imported_objects').push({
    id: 'obj-1',
    connection_id: CONNECTION_ID,
    external_object_id: 'ext-1',
    matched_property_setup_id: PROPERTY_SETUP_ID,
    matched_property_id: 'prop-a',
  });
  rows('booking_channel_imported_bookings').push({
    id: IMPORTED_BOOKING_ID,
    connection_id: CONNECTION_ID,
    external_object_id: 'ext-1',
    external_booking_id: 'book-1',
    matched_booking_id: options?.matchedBookingId === undefined ? BOOKING_OPS_ID : options.matchedBookingId,
    matched_property_setup_id: PROPERTY_SETUP_ID,
    checkin_date: '2026-07-10',
    checkout_date: '2026-07-12',
    status: 'confirmed',
  });
  if (options?.extraImported) rows('booking_channel_imported_bookings').push(options.extraImported);
  rows('booking_channel_calendar_snapshots').push(
    {
      id: 'cal-1',
      connection_id: CONNECTION_ID,
      external_object_id: 'ext-1',
      date: '2026-07-10',
      availability_status: 'booked',
    },
    {
      id: 'cal-2',
      connection_id: CONNECTION_ID,
      external_object_id: 'ext-1',
      date: '2026-07-11',
      availability_status: 'booked',
    },
    ...(options?.extraCalendar ?? []),
  );
  rows('booking_ops_records').push({
    id: BOOKING_OPS_ID,
    property_id: 'prop-a',
    check_in_at: '2026-07-10T00:00:00.000Z',
    check_out_at: '2026-07-12T00:00:00.000Z',
    normalized_status: 'confirmed',
  });
  if (options?.extraOpsBooking) rows('booking_ops_records').push(options.extraOpsBooking);
}

beforeEach(() => {
  for (const key of Object.keys(tables)) tables[key] = [];
  supabaseFrom.mockReset();
  supabaseFrom.mockImplementation((table: string) => ({
    select: vi.fn((_columns = '*', options?: { count?: string; head?: boolean }) => (
      new Query(table, { count: Boolean(options?.count), head: options?.head })
    )),
    insert: vi.fn((input: Row | Row[]) => {
      const incoming = (Array.isArray(input) ? input : [input]).map((row) => ({ ...row }));
      rows(table).push(...incoming);
      const query = new Query(table);
      (query as any).filtered = incoming;
      return query;
    }),
    update: vi.fn((patch: Row) => new Query(table, { patch })),
  }));
});

describe('Availability & Overbooking Protection v1', () => {
  it('returns no conflict for an empty calendar', () => expect(classifyAvailabilityConflicts([])).toBe('no_conflict'));
  it('detects an overlapping confirmed booking', () => {
    expect(rangesOverlap('2026-07-10', '2026-07-15', '2026-07-12', '2026-07-14')).toBe(true);
    expect(classifyAvailabilityConflicts([conflict('booking', 'confirmed')])).toBe('confirmed_conflict');
  });
  it('allows adjacent checkout and check-in', () => expect(rangesOverlap('2026-07-10', '2026-07-12', '2026-07-12', '2026-07-15')).toBe(false));
  it('classifies an active hold as possible conflict', () => expect(classifyAvailabilityConflicts([conflict('active_hold', 'possible')])).toBe('possible_conflict'));
  it('does not add released or expired holds when candidate list is empty', () => expect(classifyAvailabilityConflicts([])).toBe('no_conflict'));
  it('classifies a manual block as confirmed conflict', () => expect(classifyAvailabilityConflicts([conflict('manual_block', 'confirmed')])).toBe('confirmed_conflict'));
  it('classifies an imported booking as confirmed conflict', () => expect(classifyAvailabilityConflicts([conflict('channel_booking', 'confirmed')])).toBe('confirmed_conflict'));
  it('uses half-open nights for a contained range', () => expect(rangesOverlap('2026-07-10', '2026-07-20', '2026-07-11', '2026-07-12')).toBe(true));
  it('rejects invalid calendar dates', () => expect(normalizeAvailabilityDate('2026-02-30')).toBeNull());
  it('normalizes timestamps to a date', () => expect(normalizeAvailabilityDate('2026-07-10T13:00:00Z')).toBe('2026-07-10'));
  it('blocks check-in instructions as confirmation-like', () => expect(isConfirmationLikeCommunication({ purpose: 'send_checkin_instructions', messageText: 'Инструкции готовы.' })).toBe(true));
  it('blocks text that guarantees confirmed dates', () => expect(isConfirmationLikeCommunication({ purpose: 'issue_followup', messageText: 'Ваша бронь подтверждена, даты гарантированы.' })).toBe(true));
  it('allows neutral request acknowledgement', () => expect(isConfirmationLikeCommunication({ purpose: 'neutral_booking_acknowledgement', messageText: 'Мы получили вашу заявку.' })).toBe(false));
  it('allows checking availability message', () => expect(isConfirmationLikeCommunication({ purpose: 'neutral_status_update', messageText: 'Проверяем доступность, пожалуйста, подождите.' })).toBe(false));
  it('gives hard conflicts priority over active holds', () => expect(classifyAvailabilityConflicts([conflict('active_hold', 'possible'), conflict('booking', 'confirmed')])).toBe('confirmed_conflict'));

  it('treats booked nights covered by an imported stay as self coverage', () => {
    expect(isChannelCalendarDateCoveredByImportedBooking('2026-07-10', [
      { checkin_date: '2026-07-10', checkout_date: '2026-07-12' },
    ])).toBe(true);
    expect(isChannelCalendarDateCoveredByImportedBooking('2026-07-12', [
      { checkin_date: '2026-07-10', checkout_date: '2026-07-12' },
    ])).toBe(false);
  });

  it('collapses contiguous calendar nights into one conflict interval', () => {
    const collapsed = collapseChannelCalendarConflicts([
      { id: 'cal-1', date: '2026-07-10' },
      { id: 'cal-2', date: '2026-07-11' },
      { id: 'cal-3', date: '2026-07-13' },
    ]);
    expect(collapsed).toEqual([
      { type: 'channel_calendar', id: 'cal-1', severity: 'confirmed' },
      { type: 'channel_calendar', id: 'cal-3', severity: 'confirmed' },
    ]);
  });
});

describe('channel import availability self-conflicts', () => {
  it('does not treat a two-night booking own booked calendar rows as conflicts', async () => {
    seedSelfBookingScenario();
    const result = await checkAvailabilityConflict({
      bookingId: BOOKING_OPS_ID,
      excludeChannelImportedBookingId: IMPORTED_BOOKING_ID,
      propertySetupId: PROPERTY_SETUP_ID,
      propertyId: 'prop-a',
      dateFrom: '2026-07-10',
      dateTo: '2026-07-12',
    }, { checkType: 'channel_import', persist: false });

    expect(result.status).toBe('no_conflict');
    expect(result.conflicts).toEqual([]);
    expect(result.safeSummary).toBe('Пересечений не найдено.');
  });

  it('still blocks when another overlapping imported booking exists', async () => {
    seedSelfBookingScenario({
      extraImported: {
        id: OTHER_IMPORTED_BOOKING_ID,
        connection_id: CONNECTION_ID,
        external_object_id: 'ext-1',
        external_booking_id: 'book-2',
        matched_booking_id: OTHER_BOOKING_OPS_ID,
        matched_property_setup_id: PROPERTY_SETUP_ID,
        checkin_date: '2026-07-11',
        checkout_date: '2026-07-13',
        status: 'confirmed',
      },
    });
    const result = await checkAvailabilityConflict({
      bookingId: BOOKING_OPS_ID,
      excludeChannelImportedBookingId: IMPORTED_BOOKING_ID,
      propertySetupId: PROPERTY_SETUP_ID,
      propertyId: 'prop-a',
      dateFrom: '2026-07-10',
      dateTo: '2026-07-12',
    }, { checkType: 'channel_import', persist: false });

    expect(result.status).toBe('confirmed_conflict');
    expect(result.conflicts.some((item) => item.type === 'channel_booking' && item.id === OTHER_IMPORTED_BOOKING_ID)).toBe(true);
  });

  it('still blocks on a blocked calendar day inside the stay', async () => {
    seedSelfBookingScenario();
    rows('booking_channel_calendar_snapshots').length = 0;
    rows('booking_channel_calendar_snapshots').push(
      {
        id: 'cal-blocked',
        connection_id: CONNECTION_ID,
        external_object_id: 'ext-1',
        date: '2026-07-10',
        availability_status: 'blocked',
      },
      {
        id: 'cal-2',
        connection_id: CONNECTION_ID,
        external_object_id: 'ext-1',
        date: '2026-07-11',
        availability_status: 'booked',
      },
    );

    const result = await checkAvailabilityConflict({
      bookingId: BOOKING_OPS_ID,
      excludeChannelImportedBookingId: IMPORTED_BOOKING_ID,
      propertySetupId: PROPERTY_SETUP_ID,
      propertyId: 'prop-a',
      dateFrom: '2026-07-10',
      dateTo: '2026-07-12',
    }, { checkType: 'channel_import', persist: false });

    expect(result.status).toBe('confirmed_conflict');
    expect(result.conflicts).toEqual([
      { type: 'channel_calendar', id: 'cal-blocked', severity: 'confirmed' },
    ]);
  });

  it('still blocks unmatched booked occupancy without an imported booking cover', async () => {
    rows('booking_channel_imported_objects').push({
      id: 'obj-1',
      connection_id: CONNECTION_ID,
      external_object_id: 'ext-1',
      matched_property_setup_id: PROPERTY_SETUP_ID,
      matched_property_id: 'prop-a',
    });
    rows('booking_channel_calendar_snapshots').push({
      id: 'cal-ghost',
      connection_id: CONNECTION_ID,
      external_object_id: 'ext-1',
      date: '2026-08-01',
      availability_status: 'booked',
    });

    const result = await checkAvailabilityConflict({
      propertySetupId: PROPERTY_SETUP_ID,
      propertyId: 'prop-a',
      dateFrom: '2026-08-01',
      dateTo: '2026-08-02',
    }, { checkType: 'channel_import', persist: false });

    expect(result.status).toBe('confirmed_conflict');
    expect(result.conflicts).toEqual([
      { type: 'channel_calendar', id: 'cal-ghost', severity: 'confirmed' },
    ]);
  });

  it('auditChannelImportAvailability reports zero conflicts for own two-night calendar', async () => {
    seedSelfBookingScenario();
    const results = await auditChannelImportAvailability(CONNECTION_ID);
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('no_conflict');
    expect(results[0]?.conflicts).toEqual([]);
  });

  it('still blocks when another overlapping booking_ops stay exists', async () => {
    seedSelfBookingScenario({
      extraOpsBooking: {
        id: OTHER_BOOKING_OPS_ID,
        property_id: 'prop-a',
        check_in_at: '2026-07-11T00:00:00.000Z',
        check_out_at: '2026-07-13T00:00:00.000Z',
        normalized_status: 'confirmed',
      },
    });
    const result = await checkAvailabilityConflict({
      bookingId: BOOKING_OPS_ID,
      excludeChannelImportedBookingId: IMPORTED_BOOKING_ID,
      propertySetupId: PROPERTY_SETUP_ID,
      propertyId: 'prop-a',
      dateFrom: '2026-07-10',
      dateTo: '2026-07-12',
    }, { checkType: 'channel_import', persist: false });

    expect(result.status).toBe('confirmed_conflict');
    expect(result.conflicts.some((item) => item.type === 'booking' && item.id === OTHER_BOOKING_OPS_ID)).toBe(true);
  });
});
