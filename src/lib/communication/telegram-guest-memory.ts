import { supabase } from '@/lib/supabase';

export type TelegramGuestIdentityStatus = 'unknown' | 'unverified' | 'partially_verified' | 'verified';

export type TelegramGuestIdentityResolutionV1 = {
  telegram_chat_id: number;
  phone: string | null;
  booking_id: string | null;
  guest_id: string | null;
  status: TelegramGuestIdentityStatus;
  confidence: number;
  current_reservation: {
    reservation_id: string;
    property_id: string | null;
    guest_name: string | null;
    check_in: string | null;
    check_out: string | null;
  } | null;
  returning_guest_profile: {
    guest_id: string;
    phone: string | null;
    display_name: string | null;
    stays_count: number | null;
  } | null;
  suspicious: boolean;
  reason: string;
};

type SupabaseLike = { from: (table: string) => any };

function normalizePhone(phone: string | null | undefined): string | null {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  return digits;
}

export function extractPhoneFromTelegramText(text: string): string | null {
  const raw = String(text ?? '');
  const m = raw.match(/(?:\+?\d[\d\s().-]{8,}\d)/);
  return normalizePhone(m?.[0] ?? null);
}

export function extractBookingIdFromTelegramText(text: string): string | null {
  const raw = String(text ?? '').trim();
  const m =
    raw.match(/(?:брон[ьиь]?|бронировани[ея]|booking|reservation|номер\s+брони|№)\s*[:#№-]?\s*([A-ZА-ЯЁ0-9][A-ZА-ЯЁ0-9-]{3,})/iu) ??
    raw.match(/^(?=[A-ZА-ЯЁ0-9-]{5,}$)(?=.*\d)[A-ZА-ЯЁ0-9][A-ZА-ЯЁ0-9-]+$/iu);
  const value = String(m?.[1] ?? m?.[0] ?? '').replace(/[.,;:]+$/g, '').trim();
  return value ? value.toUpperCase() : null;
}

function firstRow(data: unknown): any | null {
  if (Array.isArray(data)) return data[0] ?? null;
  return data && typeof data === 'object' ? data : null;
}

async function maybeRows(q: any): Promise<any[]> {
  try {
    const response = typeof q?.then === 'function' ? await q : await Promise.resolve(q);
    const data = (response as any)?.data;
    return Array.isArray(data) ? data : firstRow(data) ? [firstRow(data)] : [];
  } catch {
    return [];
  }
}

async function maybeOne(q: any): Promise<any | null> {
  try {
    const response =
      typeof q?.maybeSingle === 'function'
        ? await q.maybeSingle()
        : typeof q?.single === 'function'
          ? await q.single()
          : await q;
    return firstRow((response as any)?.data);
  } catch {
    return null;
  }
}

function reservationShape(row: any): TelegramGuestIdentityResolutionV1['current_reservation'] {
  if (!row) return null;
  return {
    reservation_id: String(row.id ?? row.booking_id ?? row.reservation_id ?? ''),
    property_id: row.property_id ? String(row.property_id) : null,
    guest_name: row.guest_name ?? null,
    check_in: row.check_in ?? null,
    check_out: row.check_out ?? null,
  };
}

function profileShape(row: any): TelegramGuestIdentityResolutionV1['returning_guest_profile'] {
  if (!row?.guest_id) return null;
  const display = [row.first_name, row.last_name].map((v) => String(v ?? '').trim()).filter(Boolean).join(' ');
  return {
    guest_id: String(row.guest_id),
    phone: normalizePhone(row.phone) ?? null,
    display_name: display || row.display_name || row.guest_name || null,
    stays_count: Number.isFinite(Number(row.stays_count)) ? Number(row.stays_count) : null,
  };
}

function hasSamePhone(a: string | null, b: string | null): boolean {
  return Boolean(a && b && normalizePhone(a) === normalizePhone(b));
}

export function canRevealTelegramAccessDetails(identity: TelegramGuestIdentityResolutionV1 | null | undefined): boolean {
  return identity?.status === 'verified' && identity.confidence >= 0.85 && !identity.suspicious;
}

export function buildUnverifiedAccessReplyRu(): string {
  return 'Поняла, это срочно. Уже передаю оператору по доступу. В целях безопасности код двери отправим только после проверки брони.';
}

export async function resolveTelegramGuestIdentityV1(params: {
  telegram_chat_id: number;
  text?: string;
  phone?: string | null;
  booking_id?: string | null;
  db?: SupabaseLike;
}): Promise<TelegramGuestIdentityResolutionV1> {
  const db = params.db ?? (supabase as unknown as SupabaseLike);
  const chatId = Number(params.telegram_chat_id);
  const phone = normalizePhone(params.phone) ?? extractPhoneFromTelegramText(params.text ?? '');
  const bookingId = (params.booking_id ?? extractBookingIdFromTelegramText(params.text ?? '') ?? '').trim().toUpperCase() || null;

  const base = (overrides: Partial<TelegramGuestIdentityResolutionV1>): TelegramGuestIdentityResolutionV1 => ({
    telegram_chat_id: chatId,
    phone,
    booking_id: bookingId,
    guest_id: null,
    status: 'unknown',
    confidence: 0,
    current_reservation: null,
    returning_guest_profile: null,
    suspicious: false,
    reason: 'no_identity_evidence',
    ...overrides,
  });

  const suspiciousByChat = Number.isFinite(chatId)
    ? await maybeOne(db.from('tg_suspicious_users').select('telegram_chat_id, phone, reason').eq('telegram_chat_id', chatId).limit(1))
    : null;
  const suspiciousByPhone = phone
    ? await maybeOne(db.from('tg_suspicious_users').select('telegram_chat_id, phone, reason').eq('phone', phone).limit(1))
    : null;
  if (suspiciousByChat || suspiciousByPhone) {
    return base({ suspicious: true, status: 'unknown', confidence: 0, reason: 'suspicious_user_match' });
  }

  const identity = Number.isFinite(chatId)
    ? await maybeOne(
        db
          .from('tg_guest_identities')
          .select('guest_id, telegram_chat_id, first_name, last_name, display_name, phone, stays_count')
          .eq('telegram_chat_id', chatId)
          .limit(1),
      )
    : null;
  const profileByPhone = !identity && phone
    ? await maybeOne(db.from('tg_guest_profiles').select('guest_id, display_name, phone, stays_count').eq('phone', phone).limit(1))
    : null;
  const profile = profileShape(identity) ?? profileShape(profileByPhone);
  const guestId = profile?.guest_id ?? null;

  let bookingRows: any[] = [];
  if (bookingId) {
    bookingRows = await maybeRows(
      db
        .from('tg_guest_reservations')
        .select('id, booking_id, property_id, guest_id, guest_name, phone, guest_phone, check_in, check_out, chat_id')
        .eq('id', bookingId)
        .limit(3),
    );
    if (bookingRows.length === 0) {
      bookingRows = await maybeRows(
        db
          .from('tg_guest_reservations')
          .select('id, booking_id, property_id, guest_id, guest_name, phone, guest_phone, check_in, check_out, chat_id')
          .eq('booking_id', bookingId)
          .limit(3),
      );
    }
  }

  let reservationRows = bookingRows;
  if (reservationRows.length === 0 && guestId) {
    reservationRows = await maybeRows(
      db
        .from('tg_guest_reservations')
        .select('id, booking_id, property_id, guest_id, guest_name, phone, guest_phone, check_in, check_out, chat_id')
        .eq('guest_id', guestId)
        .order('check_in', { ascending: false })
        .limit(3),
    );
  }
  if (reservationRows.length === 0 && Number.isFinite(chatId)) {
    reservationRows = await maybeRows(
      db
        .from('tg_guest_reservations')
        .select('id, booking_id, property_id, guest_id, guest_name, phone, guest_phone, check_in, check_out, chat_id')
        .eq('chat_id', chatId)
        .order('check_in', { ascending: false })
        .limit(3),
    );
  }

  const reservation = reservationRows[0] ?? null;
  const reservationPhone = normalizePhone(reservation?.phone ?? reservation?.guest_phone ?? null);
  const reservationGuestId = reservation?.guest_id ? String(reservation.guest_id) : null;
  const phoneMatches = hasSamePhone(phone, reservationPhone) || hasSamePhone(phone, profile?.phone ?? null);
  const chatMatchesReservation = Number.isFinite(chatId) && Number(reservation?.chat_id) === chatId;
  const bookingMatches = Boolean(bookingId && reservation && (String(reservation.id).toUpperCase() === bookingId || String(reservation.booking_id ?? '').toUpperCase() === bookingId));

  if (reservation && ((bookingMatches && phoneMatches) || (guestId && reservationGuestId === guestId && (phoneMatches || chatMatchesReservation)))) {
    return base({
      guest_id: guestId ?? reservationGuestId,
      status: 'verified',
      confidence: 0.95,
      current_reservation: reservationShape(reservation),
      returning_guest_profile: profile,
      reason: bookingMatches ? 'booking_and_phone_match' : 'chat_identity_reservation_match',
    });
  }

  if (profile && reservation) {
    return base({
      guest_id: guestId,
      status: 'partially_verified',
      confidence: 0.65,
      current_reservation: reservationShape(reservation),
      returning_guest_profile: profile,
      reason: 'returning_guest_profile_found_needs_verification',
    });
  }

  if (profile) {
    return base({
      guest_id: guestId,
      status: 'partially_verified',
      confidence: 0.55,
      returning_guest_profile: profile,
      reason: 'returning_guest_profile_found',
    });
  }

  if (bookingId || phone) {
    return base({
      status: 'unverified',
      confidence: 0.25,
      current_reservation: reservationShape(reservation),
      guest_id: reservationGuestId,
      reason: reservation ? 'reservation_found_but_not_verified' : 'provided_identity_unmatched',
    });
  }

  return base({});
}
