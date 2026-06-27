import { normalizeBookingChannel } from '@/lib/bookings/types';
import { isPilotAcceptanceBooking, text as cleanText } from '@/lib/pilot-data/test-markers';
import type { CreateBookingOpsInput, BookingOpsRecord, BookingOpsStatus } from './types';
import { BOOKING_OPS_STATUSES, hasGuestContact } from './types';

export type GuestReservationSnapshot = {
  id: string;
  reservationRef: string | null;
  propertyId: string | null;
  guestName: string | null;
  guestContact: string | null;
  guestPhone: string | null;
  phone: string | null;
  email: string | null;
  chatId: number | null;
  guestId: string | null;
  checkIn: string | null;
  checkOut: string | null;
  bookingChannel: string | null;
  status: string | null;
  note: string | null;
  pilotAcceptanceMarker: string | null;
};

export type GuestReservationRow = {
  id: string;
  reservation_ref?: string | null;
  property_id?: string | null;
  guest_name?: string | null;
  guest_contact?: string | null;
  guest_phone?: string | null;
  phone?: string | null;
  email?: string | null;
  chat_id?: number | null;
  guest_id?: string | null;
  check_in?: string | null;
  check_out?: string | null;
  booking_channel?: string | null;
  status?: string | null;
  note?: string | null;
  pilot_acceptance_marker?: string | null;
};

function text(value: unknown): string {
  return cleanText(value);
}

export function mapGuestReservationRow(row: GuestReservationRow): GuestReservationSnapshot {
  return {
    id: row.id,
    reservationRef: text(row.reservation_ref) || null,
    propertyId: text(row.property_id) || null,
    guestName: text(row.guest_name) || null,
    guestContact: text(row.guest_contact) || null,
    guestPhone: text(row.guest_phone) || null,
    phone: text(row.phone) || null,
    email: text(row.email) || null,
    chatId: typeof row.chat_id === 'number' ? row.chat_id : null,
    guestId: text(row.guest_id) || null,
    checkIn: row.check_in ?? null,
    checkOut: row.check_out ?? null,
    bookingChannel: text(row.booking_channel) || null,
    status: text(row.status) || null,
    note: text(row.note) || null,
    pilotAcceptanceMarker: text(row.pilot_acceptance_marker) || null,
  };
}

function extractGuestPhone(snapshot: GuestReservationSnapshot): string | null {
  return snapshot.guestContact || snapshot.guestPhone || snapshot.phone || null;
}

function extractGuestTelegram(snapshot: GuestReservationSnapshot): string | null {
  if (snapshot.chatId != null) return `tg_${snapshot.chatId}`;
  const guestId = snapshot.guestId ?? '';
  if (guestId.startsWith('tg_')) return guestId;
  return null;
}

export function shouldSkipReservationBookingOpsSync(snapshot: GuestReservationSnapshot): string | null {
  if (isPilotAcceptanceBooking({
    propertyId: snapshot.propertyId,
    reservationRef: snapshot.reservationRef,
    comment: snapshot.note,
    pilotAcceptanceMarker: snapshot.pilotAcceptanceMarker,
  })) {
    return 'pilot_acceptance_booking';
  }

  const status = String(snapshot.status ?? '').trim().toLowerCase();
  if (status === 'cancelled') return 'cancelled_reservation';
  return null;
}

export function mapReservationToBookingOpsInput(
  snapshot: GuestReservationSnapshot,
): CreateBookingOpsInput {
  const guestPhone = extractGuestPhone(snapshot);
  const guestTelegram = extractGuestTelegram(snapshot);
  const contactKnown = Boolean(
    guestPhone || snapshot.email || guestTelegram,
  );

  return {
    bookingId: snapshot.id,
    guestName: snapshot.guestName,
    guestPhone,
    guestEmail: snapshot.email,
    guestTelegram,
    propertyId: snapshot.propertyId,
    propertyLabel: null,
    otaSource: normalizeBookingChannel(snapshot.bookingChannel),
    checkInAt: snapshot.checkIn,
    checkOutAt: snapshot.checkOut,
    opsStatus: contactKnown ? 'guest_contact_known' : 'created',
  };
}

export function opsStatusRank(status: BookingOpsStatus): number {
  const index = BOOKING_OPS_STATUSES.indexOf(status);
  return index >= 0 ? index : 0;
}

export function wouldDowngradeOpsStatus(
  current: BookingOpsStatus,
  next: BookingOpsStatus,
): boolean {
  if (current === next) return false;
  return opsStatusRank(next) < opsStatusRank(current);
}

export function buildSafeSourceFieldPatch(
  existing: BookingOpsRecord,
  derived: CreateBookingOpsInput,
): Partial<CreateBookingOpsInput> {
  const patch: Partial<CreateBookingOpsInput> = {};

  if (derived.guestName && derived.guestName !== existing.guestName) {
    patch.guestName = derived.guestName;
  }
  if (derived.guestPhone && derived.guestPhone !== existing.guestPhone) {
    patch.guestPhone = derived.guestPhone;
  }
  if (derived.guestEmail && derived.guestEmail !== existing.guestEmail) {
    patch.guestEmail = derived.guestEmail;
  }
  if (derived.guestTelegram && derived.guestTelegram !== existing.guestTelegram) {
    patch.guestTelegram = derived.guestTelegram;
  }
  if (derived.propertyId && derived.propertyId !== existing.propertyId) {
    patch.propertyId = derived.propertyId;
  }
  if (derived.otaSource && derived.otaSource !== existing.otaSource) {
    patch.otaSource = derived.otaSource;
  }
  if (derived.checkInAt && derived.checkInAt !== existing.checkInAt) {
    patch.checkInAt = derived.checkInAt;
  }
  if (derived.checkOutAt && derived.checkOutAt !== existing.checkOutAt) {
    patch.checkOutAt = derived.checkOutAt;
  }

  const mergedContact = {
    guestPhone: patch.guestPhone ?? existing.guestPhone,
    guestEmail: patch.guestEmail ?? existing.guestEmail,
    guestTelegram: patch.guestTelegram ?? existing.guestTelegram,
  };
  if (
    hasGuestContact(mergedContact)
    && existing.opsStatus === 'created'
    && !patch.opsStatus
  ) {
    patch.opsStatus = 'guest_contact_known';
  }

  return patch;
}
