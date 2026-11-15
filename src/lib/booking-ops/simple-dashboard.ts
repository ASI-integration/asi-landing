import type { BookingOpsRecord } from './types';

/** A display-only marker. The API keeps account scoping and access control. */
export function isSyntheticBooking(record: Pick<BookingOpsRecord, 'bookingId' | 'propertyLabel'>): boolean {
  return /(?:^|[-_ ])(?:SYNTHETIC|MOCK|E2E)(?:[-_ ]|$)/i.test(
    [record.bookingId, record.propertyLabel].filter(Boolean).join(' '),
  ) || /^(?:test-prop|mock-prop)/i.test(record.propertyLabel ?? '');
}

export function summarizeRealBookings(records: BookingOpsRecord[], nowMs: number): {
  total: number;
  attention: number;
  upcoming: number;
} {
  const real = records.filter((record) => !isSyntheticBooking(record));
  const attention = real.filter((record) => record.isBlocked).length;
  const upcoming = real.filter((record) => {
    if (!record.checkInAt) return false;
    const at = Date.parse(record.checkInAt);
    return Number.isFinite(at) && at >= nowMs && at <= nowMs + 7 * 86400000;
  }).length;
  return { total: real.length, attention, upcoming };
}
