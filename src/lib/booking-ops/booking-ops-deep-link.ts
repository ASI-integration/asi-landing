export const BOOKING_OPS_DASHBOARD_PATH = '/dashboard/booking-ops';

export const BOOKING_OPS_FOCUS_TARGETS = [
  'guest',
  'legal',
  'payment',
  'cleaning',
  'readiness',
  'tasks',
] as const;

export type BookingOpsFocusTarget = (typeof BOOKING_OPS_FOCUS_TARGETS)[number];

export function isBookingOpsFocusTarget(value: string | null | undefined): value is BookingOpsFocusTarget {
  return Boolean(value && (BOOKING_OPS_FOCUS_TARGETS as readonly string[]).includes(value));
}

export function bookingOpsFocusElementId(focus: BookingOpsFocusTarget): string {
  return `booking-ops-focus-${focus}`;
}

export function buildBookingOpsDeepLink(
  bookingOpsId: string,
  focus?: BookingOpsFocusTarget | null,
): string {
  const id = bookingOpsId.trim();
  if (!id) return BOOKING_OPS_DASHBOARD_PATH;
  const params = new URLSearchParams({ bookingId: id });
  if (focus && isBookingOpsFocusTarget(focus)) {
    params.set('focus', focus);
  }
  return `${BOOKING_OPS_DASHBOARD_PATH}?${params.toString()}`;
}

export function resolveBookingOpsDeepLinkSelection<T extends { id: string; bookingId?: string | null }>(
  records: T[],
  search: string | URLSearchParams | { get(name: string): string | null },
): { record: T | null; focus: BookingOpsFocusTarget | null } {
  const params =
    typeof search === 'string'
      ? new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
      : search;
  const requestedId = String(params.get('bookingId') ?? '').trim();
  const focusRaw = String(params.get('focus') ?? '').trim();
  const focus = isBookingOpsFocusTarget(focusRaw) ? focusRaw : null;

  if (!requestedId || records.length === 0) {
    return { record: null, focus };
  }

  const byId = records.find((record) => record.id === requestedId);
  if (byId) return { record: byId, focus };

  const byExternal = records.find((record) => record.bookingId?.trim() === requestedId);
  return { record: byExternal ?? null, focus };
}
