import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, unknown>;

const {
  supabaseFrom,
  updateBookingOpsRecord,
  resolveResidentialBookingIdentity,
  processInboundBookingRequest,
} = vi.hoisted(() => ({
  supabaseFrom: vi.fn(),
  updateBookingOpsRecord: vi.fn(),
  resolveResidentialBookingIdentity: vi.fn(),
  processInboundBookingRequest: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => supabaseFrom(...args) },
}));
vi.mock('@/lib/booking-ops/repository', () => ({ updateBookingOpsRecord }));
vi.mock('@/lib/platform/residential-booking-scope', () => ({ resolveResidentialBookingIdentity }));
vi.mock('@/lib/booking-ops/real-booking-intake-autopilot', () => ({ processInboundBookingRequest }));

import { cancelReservation, createDirectReservation, restoreReservation } from '../ledger';

class Query {
  public readonly eq = vi.fn((_column: string, _value: unknown) => this);
  public readonly neq = vi.fn((_column: string, _value: unknown) => this);
  public readonly in = vi.fn((_column: string, _values: unknown[]) => this);
  public readonly lt = vi.fn((_column: string, _value: unknown) => this);
  public readonly gt = vi.fn((_column: string, _value: unknown) => this);
  public readonly or = vi.fn((_filter: string) => this);
  public readonly select = vi.fn((_columns?: string) => this);
  public readonly update = vi.fn((_patch: Row) => this);
  public readonly insert = vi.fn((_row: Row) => this);

  constructor(private readonly result: { data: unknown; error: null | { message: string } }) {}

  async maybeSingle() {
    return this.result;
  }

  then(resolve: (value: { data: unknown; error: null | { message: string } }) => unknown) {
    return Promise.resolve(this.result).then(resolve);
  }
}

const queues = new Map<string, Query[]>();

function enqueue(table: string, result: { data: unknown; error?: null | { message: string } }) {
  const query = new Query({ data: result.data, error: result.error ?? null });
  queues.set(table, [...(queues.get(table) ?? []), query]);
  return query;
}

beforeEach(() => {
  vi.clearAllMocks();
  queues.clear();
  supabaseFrom.mockImplementation((table: string) => {
    const queue = queues.get(table) ?? [];
    const query = queue.shift();
    queues.set(table, queue);
    if (!query) throw new Error(`unexpected table access: ${table}`);
    return query;
  });
  resolveResidentialBookingIdentity.mockResolvedValue({
    kind: 'identified',
    accountId: 'account-a',
    propertyId: 'prop-a',
    bookingId: 'booking-a',
  });
  updateBookingOpsRecord.mockResolvedValue({ ok: true, record: { id: 'booking-a' } });
});


describe('reservation mutation canonical scope', () => {
  const directInput = {
    accountId: 'account-a',
    actorId: 'operator-a',
    idempotencyKey: 'create-a',
    propertyId: 'prop-a',
    checkIn: '2026-10-10',
    checkOut: '2026-10-12',
    guestName: 'Guest',
    guestCount: 2,
    sourceType: 'manual' as const,
    bookingReference: 'REF-A',
    confirmationMode: 'inquiry' as const,
  };

  it('keeps direct creation bound to the canonical account and property', async () => {
    processInboundBookingRequest.mockResolvedValue({ bookingId: 'booking-a', intakeStatus: 'processed' });
    enqueue('booking_inbound_intake_events', { data: null });
    enqueue('booking_ops_records', { data: [] });
    enqueue('booking_availability_holds', { data: [] });
    enqueue('booking_availability_blocks', { data: [] });
    const patch = enqueue('booking_ops_records', { data: { asi_reference: 'ASI-A' } });
    enqueue('reservation_ledger_audit', { data: null });

    const result = await createDirectReservation(directInput);

    expect(result).toEqual(expect.objectContaining({
      created: true,
      reservationId: 'booking-a',
      reference: 'ASI-A',
    }));
    expect(resolveResidentialBookingIdentity).toHaveBeenCalledWith('booking-a', 'account-a');
    expect(patch.eq).toHaveBeenCalledWith('account_id', 'account-a');
    expect(patch.eq).toHaveBeenCalledWith('property_id', 'prop-a');
  });

  it('fails direct creation closed when the intake booking resolves to another property', async () => {
    processInboundBookingRequest.mockResolvedValue({ bookingId: 'booking-a', intakeStatus: 'processed' });
    resolveResidentialBookingIdentity.mockResolvedValue({
      kind: 'identified',
      accountId: 'account-a',
      propertyId: 'prop-b',
      bookingId: 'booking-a',
    });
    enqueue('booking_inbound_intake_events', { data: null });
    enqueue('booking_ops_records', { data: [] });
    enqueue('booking_availability_holds', { data: [] });
    enqueue('booking_availability_blocks', { data: [] });

    await expect(createDirectReservation(directInput)).rejects.toThrow('booking_scope_mismatch');

    expect(queues.get('reservation_ledger_audit')).toBeUndefined();
    expect(supabaseFrom.mock.calls.filter(([table]) => table === 'booking_ops_records')).toHaveLength(1);
  });

  it('rejects an idempotent existing reservation from another property', async () => {
    resolveResidentialBookingIdentity.mockResolvedValue({
      kind: 'identified',
      accountId: 'account-a',
      propertyId: 'prop-b',
      bookingId: 'booking-a',
    });
    enqueue('booking_inbound_intake_events', {
      data: { booking_id: 'booking-a', status: 'processed' },
    });

    await expect(createDirectReservation(directInput)).rejects.toThrow('booking_scope_mismatch');

    expect(processInboundBookingRequest).not.toHaveBeenCalled();
  });

  it('keeps cancellation bound to the canonical account and property', async () => {
    const current = enqueue('booking_ops_records', {
      data: { normalized_status: 'confirmed', property_id: 'prop-a' },
    });
    const saved = enqueue('booking_ops_records', { data: { id: 'booking-a' } });
    const holds = enqueue('booking_availability_holds', { data: null });
    enqueue('reservation_ledger_audit', { data: null });

    const result = await cancelReservation({
      accountId: 'account-a',
      reservationId: 'booking-a',
      actorId: 'operator-a',
      reason: 'guest_cancelled',
    });

    expect(result).toEqual({ changed: true });
    expect(resolveResidentialBookingIdentity).toHaveBeenCalledWith('booking-a', 'account-a');
    expect(current.eq).toHaveBeenCalledWith('property_id', 'prop-a');
    expect(saved.eq).toHaveBeenCalledWith('property_id', 'prop-a');
    expect(holds.eq).toHaveBeenCalledWith('property_id', 'prop-a');
    expect(updateBookingOpsRecord).toHaveBeenCalledWith(
      'booking-a',
      { isBlocked: true, blockerReason: 'Reservation cancelled' },
      {
        actorType: 'admin',
        expectedScope: { accountId: 'account-a', propertyId: 'prop-a' },
      },
    );
  });

  it('fails cancellation closed when the booking leaves scope before persistence', async () => {
    enqueue('booking_ops_records', {
      data: { normalized_status: 'confirmed', property_id: 'prop-a' },
    });
    enqueue('booking_ops_records', { data: null });

    await expect(cancelReservation({
      accountId: 'account-a',
      reservationId: 'booking-a',
      actorId: 'operator-a',
    })).rejects.toThrow('booking_scope_mismatch');

    expect(updateBookingOpsRecord).not.toHaveBeenCalled();
    expect(queues.get('booking_availability_holds')).toBeUndefined();
  });

  it('rejects restore when the requested property differs from canonical scope', async () => {
    await expect(restoreReservation({
      accountId: 'account-a',
      reservationId: 'booking-a',
      actorId: 'operator-a',
      propertyId: 'prop-b',
      checkIn: '2026-10-10',
      checkOut: '2026-10-12',
    })).rejects.toThrow('booking_scope_mismatch');

    expect(supabaseFrom).not.toHaveBeenCalled();
    expect(updateBookingOpsRecord).not.toHaveBeenCalled();
  });
});
