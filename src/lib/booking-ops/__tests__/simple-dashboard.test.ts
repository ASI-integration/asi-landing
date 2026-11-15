import { describe, expect, it } from 'vitest';
import type { BookingOpsRecord } from '../types';
import { isSyntheticBooking, summarizeRealBookings } from '../simple-dashboard';

function record(
  bookingId: string,
  options: { propertyLabel?: string; isBlocked?: boolean; checkInAt?: string | null } = {},
): BookingOpsRecord {
  return {
    bookingId,
    propertyLabel: options.propertyLabel ?? 'Апартаменты на Невском',
    checkInAt: options.checkInAt ?? null,
    isBlocked: options.isBlocked ?? false,
  } as BookingOpsRecord;
}

describe('simple booking dashboard', () => {
  const now = Date.parse('2026-11-15T00:00:00Z');

  it('shows synthetic reservations only after opt-in, not in real booking counts', () => {
    const demo = record('SYNTHETIC-ASI-G3G6-20261115', { isBlocked: true, checkInAt: '2026-11-18T00:00:00Z' });
    const real = record('BOOK-101', { checkInAt: '2026-11-17T00:00:00Z' });
    expect(isSyntheticBooking(demo)).toBe(true);
    expect(isSyntheticBooking(real)).toBe(false);
    expect(summarizeRealBookings([demo, real], now)).toEqual({ total: 1, attention: 0, upcoming: 1 });
  });

  it('never treats ordinary words containing test as a synthetic marker', () => {
    expect(isSyntheticBooking(record('BOOK-202', { propertyLabel: 'Тестовская улица, 2' }))).toBe(false);
    expect(isSyntheticBooking(record('BOOK-203', { propertyLabel: 'Westend Apartments' }))).toBe(false);
    expect(isSyntheticBooking(record('MOCK-CHECK-04'))).toBe(true);
  });

  it('counts blockers without asserting that unblocked bookings are ready', () => {
    expect(summarizeRealBookings([
      record('BOOK-1', { isBlocked: true, checkInAt: '2026-11-15T12:00:00Z' }),
      record('BOOK-2', { checkInAt: '2026-11-30T00:00:00Z' }),
      record('BOOK-3', { checkInAt: 'not-a-date' }),
    ], now)).toEqual({ total: 3, attention: 1, upcoming: 1 });
  });
});
