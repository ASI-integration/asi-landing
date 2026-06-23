import { randomUUID } from 'node:crypto';
import { isPilotAcceptanceBooking, text as cleanText } from '@/lib/pilot-data/test-markers';
import { supabase } from '@/lib/supabase';
import {
  type BookingChannel,
  type BookingStatus,
  type CreatePilotBookingInput,
  type PilotBooking,
  type UpdatePilotBookingInput,
  normalizeBookingChannel,
  normalizeBookingStatus,
} from './types';

type ReservationRow = {
  id: string;
  reservation_ref: string | null;
  property_id: string | null;
  guest_name: string | null;
  guest_contact: string | null;
  phone: string | null;
  guest_phone: string | null;
  check_in: string | null;
  check_out: string | null;
  booking_channel: string | null;
  status: string | null;
  note: string | null;
  pilot_acceptance_marker: string | null;
  created_at: string;
  updated_at: string;
};

function text(value: unknown): string {
  return cleanText(value);
}

function toIsoDate(value: string | null | undefined): string | null {
  const raw = text(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function mapRow(row: ReservationRow): PilotBooking {
  const guestContact =
    text(row.guest_contact) || text(row.guest_phone) || text(row.phone) || null;
  return {
    id: row.id,
    reservationRef: text(row.reservation_ref) || row.id,
    propertyId: text(row.property_id),
    guestName: text(row.guest_name) || null,
    guestContact,
    checkIn: row.check_in,
    checkOut: row.check_out,
    channel: normalizeBookingChannel(row.booking_channel),
    status: normalizeBookingStatus(row.status),
    comment: text(row.note) || null,
    pilotAcceptanceMarker: text(row.pilot_acceptance_marker) || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildReservationRef(input: CreatePilotBookingInput): string {
  const explicit = text(input.reservationRef);
  if (explicit) return explicit;
  const marker = text(input.pilotAcceptanceMarker);
  if (marker) return `pilot-${marker}`;
  return `pilot-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

export async function listPilotBookings(options?: {
  limit?: number;
  includeTest?: boolean;
}): Promise<PilotBooking[]> {
  const limit = options?.limit ?? 200;
  const { data, error } = await supabase
    .from('tg_guest_reservations')
    .select('*')
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];
  const bookings = (data as ReservationRow[]).map(mapRow);
  if (options?.includeTest) return bookings;
  return bookings.filter(
    (booking) =>
      !isPilotAcceptanceBooking({
        propertyId: booking.propertyId,
        reservationRef: booking.reservationRef,
        comment: booking.comment,
        pilotAcceptanceMarker: booking.pilotAcceptanceMarker,
      }),
  );
}

export async function getPilotBooking(id: string): Promise<PilotBooking | null> {
  const { data, error } = await supabase
    .from('tg_guest_reservations')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) return null;
  return mapRow(data as ReservationRow);
}

export async function createPilotBooking(input: CreatePilotBookingInput): Promise<{
  ok: boolean;
  booking?: PilotBooking;
  created?: boolean;
  error?: string;
}> {
  const propertyId = text(input.propertyId);
  if (!propertyId) return { ok: false, error: 'property_id_required' };

  const reservationRef = buildReservationRef(input);
  const { data: existing } = await supabase
    .from('tg_guest_reservations')
    .select('id')
    .eq('reservation_ref', reservationRef)
    .maybeSingle();

  const id = (existing as { id?: string } | null)?.id ?? randomUUID();
  const now = new Date().toISOString();
  const channel: BookingChannel = normalizeBookingChannel(input.channel);
  const status: BookingStatus = normalizeBookingStatus(input.status ?? 'new');

  const row: Record<string, unknown> = {
    id,
    reservation_ref: reservationRef,
    property_id: propertyId,
    guest_name: text(input.guestName) || null,
    guest_contact: text(input.guestContact) || null,
    phone: text(input.guestContact) || null,
    check_in: toIsoDate(input.checkIn),
    check_out: toIsoDate(input.checkOut),
    booking_channel: channel,
    status,
    note: text(input.comment) || null,
    pilot_acceptance_marker: text(input.pilotAcceptanceMarker) || null,
    updated_at: now,
  };

  if (!existing) {
    row.created_at = now;
    row.guest_id = `pilot_${id.slice(0, 8)}`;
  }

  const { data, error } = await supabase
    .from('tg_guest_reservations')
    .upsert(row, { onConflict: 'id' })
    .select('*')
    .single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, booking: mapRow(data as ReservationRow), created: !existing };
}

export async function updatePilotBooking(
  id: string,
  input: UpdatePilotBookingInput,
): Promise<{ ok: boolean; booking?: PilotBooking; error?: string }> {
  const bookingId = text(id);
  if (!bookingId) return { ok: false, error: 'id_required' };

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.propertyId !== undefined) patch.property_id = text(input.propertyId) || null;
  if (input.guestName !== undefined) patch.guest_name = text(input.guestName) || null;
  if (input.guestContact !== undefined) {
    patch.guest_contact = text(input.guestContact) || null;
    patch.phone = text(input.guestContact) || null;
  }
  if (input.checkIn !== undefined) patch.check_in = toIsoDate(input.checkIn);
  if (input.checkOut !== undefined) patch.check_out = toIsoDate(input.checkOut);
  if (input.channel !== undefined) patch.booking_channel = normalizeBookingChannel(input.channel);
  if (input.status !== undefined) patch.status = normalizeBookingStatus(input.status);
  if (input.comment !== undefined) patch.note = text(input.comment) || null;

  const { data, error } = await supabase
    .from('tg_guest_reservations')
    .update(patch)
    .eq('id', bookingId)
    .select('*')
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: 'not_found' };
  return { ok: true, booking: mapRow(data as ReservationRow) };
}
