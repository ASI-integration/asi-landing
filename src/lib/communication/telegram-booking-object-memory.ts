import { supabase } from '@/lib/supabase';
import {
  isIncompleteOrTestAddress,
  localizePropertySnippet,
  normalizeGuestAddress,
  sanitizeGuestFacingReply,
} from './guest-facing-ru';
import {
  canRevealTelegramAccessDetails,
  extractBookingIdFromTelegramText,
  extractPhoneFromTelegramText,
  resolveTelegramGuestIdentityV1,
  type TelegramGuestIdentityResolutionV1,
} from './telegram-guest-memory';
import {
  get_object_knowledge_entries,
  is_stale,
  type ObjectKnowledgeEntry,
  type ObjectKnowledgeStatus,
} from './object-knowledge';
import {
  composeWifiProblemSubtypeReplyRu,
  detectWifiProblemSubtype,
  type WifiProblemStep,
} from './wifi-escalation-policy';

type SupabaseLike = { from: (table: string) => any };

export type TelegramPropertyObjectV1 = {
  object_id: string;
  object_name: string | null;
  address: string | null;
  directions_text: string | null;
  parking_text: string | null;
  trash_bins_location: string | null;
  waste_disposal_text: string | null;
  wifi_name: string | null;
  wifi_password: string | null;
  baby_crib_available: boolean | null;
  baby_crib_note: string | null;
  check_in_text: string | null;
  checkout_time: string | null;
  house_rules_text: string | null;
  door_code_notes: string | null;
  communication_autopilot?: 'enabled' | 'disabled' | null;
  knowledge_status?: Partial<Record<string, ObjectKnowledgeStatus>>;
};

export type TelegramGuestBookingV1 = {
  booking_id: string;
  reservation_id: string;
  guest_name: string | null;
  guest_phone: string | null;
  telegram_chat_id: number | null;
  object_id: string | null;
  check_in_date: string | null;
  check_out_date: string | null;
  status: string;
  access_verified: boolean;
};

export type TelegramBookingObjectContextV1 = {
  booking: TelegramGuestBookingV1 | null;
  property: TelegramPropertyObjectV1 | null;
  identity: TelegramGuestIdentityResolutionV1 | null;
  booking_resolved: boolean;
  property_resolved: boolean;
  access_verified: boolean;
  wifi_verified: boolean;
  lookup_reason: string;
};

function stringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

function normalizePhone(phone: string | null | undefined): string | null {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length < 10) return null;
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  return digits;
}

function normalizeGuestEmail(email: string | null | undefined): string | null {
  const raw = String(email ?? '').trim().toLowerCase();
  if (!raw) return null;
  const match = raw.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/i);
  return match?.[0]?.toLowerCase() ?? null;
}

const OBJECT_KNOWLEDGE_CONTEXT_KEYS = [
  'object_name',
  'address',
  'directions_text',
  'parking_text',
  'trash_bins_location',
  'waste_disposal_text',
  'wifi_name',
  'wifi_password',
  'baby_crib_available',
  'baby_crib_note',
  'checkout_rules',
  'checkout_time',
  'house_rules_text',
  'check_in_text',
  'door_code_notes',
] as const;

export function canRevealEmailAccessDetails(params: {
  senderEmail: string;
  booking: TelegramGuestBookingV1 | null | undefined;
  knownGuestEmail?: string | null;
}): boolean {
  const sender = normalizeGuestEmail(params.senderEmail);
  if (!sender || !params.booking) return false;
  const known = normalizeGuestEmail(params.knownGuestEmail);
  if (known && known === sender) return true;
  return Boolean(params.booking.access_verified);
}

async function maybeRows(q: any): Promise<any[]> {
  try {
    const response = typeof q?.then === 'function' ? await q : await Promise.resolve(q);
    const data = (response as any)?.data;
    return Array.isArray(data) ? data : data && typeof data === 'object' ? [data] : [];
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
    const data = (response as any)?.data;
    if (Array.isArray(data)) return data[0] ?? null;
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

function mapPropertyRow(row: any): TelegramPropertyObjectV1 {
  const parkingParts = [
    stringOrNull(row?.parking_text),
    stringOrNull(row?.parking_rules),
    stringOrNull(row?.parking_location_notes),
    stringOrNull(row?.parking_paid_or_free),
  ].filter(Boolean);
  const directions =
    stringOrNull(row?.directions_text) ??
    stringOrNull(row?.access_notes) ??
    stringOrNull(row?.checkin_instructions) ??
    stringOrNull(row?.check_in_text);

  return {
    object_id: String(row?.property_id ?? ''),
    object_name: stringOrNull(row?.object_name) ?? stringOrNull(row?.location),
    address: stringOrNull(row?.address) ?? stringOrNull(row?.location),
    directions_text: directions,
    parking_text: parkingParts.length > 0 ? parkingParts.join('. ') : null,
    trash_bins_location: stringOrNull(row?.trash_bins_location),
    waste_disposal_text: stringOrNull(row?.waste_disposal_text),
    wifi_name: stringOrNull(row?.wifi_name),
    wifi_password: stringOrNull(row?.wifi_password),
    baby_crib_available: typeof row?.baby_crib_available === 'boolean' ? row.baby_crib_available : null,
    baby_crib_note: stringOrNull(row?.baby_crib_note),
    check_in_text: stringOrNull(row?.check_in_text) ?? stringOrNull(row?.checkin_instructions),
    checkout_time: stringOrNull(row?.check_out_time),
    house_rules_text: stringOrNull(row?.house_rules_text) ?? stringOrNull(row?.house_rules),
    door_code_notes: stringOrNull(row?.door_code_notes),
    communication_autopilot:
      String(row?.communication_autopilot ?? '').trim().toLowerCase() === 'enabled' ? 'enabled' : 'disabled',
  };
}

function entryBoolean(entry: ObjectKnowledgeEntry | undefined): boolean | null {
  if (!entry) return null;
  if (typeof entry.value_json?.available === 'boolean') return entry.value_json.available;
  const text = String(entry.value_text ?? '').trim();
  if (/^(true|yes|1|available|да|есть)$/i.test(text)) return true;
  if (/^(false|no|0|not_available|нет)$/i.test(text)) return false;
  return null;
}

function knowledgeEntryStatus(entry: ObjectKnowledgeEntry | undefined): ObjectKnowledgeStatus | undefined {
  if (!entry) return undefined;
  if (is_stale(entry)) return 'stale';
  if (entry.confidence === 'low') return 'low_confidence';
  return 'found';
}

function mapObjectKnowledgeEntriesToProperty(objectId: string, entries: ObjectKnowledgeEntry[]): TelegramPropertyObjectV1 | null {
  if (entries.length === 0) return null;
  const keyed: Record<string, ObjectKnowledgeEntry> = {};
  for (const entry of entries) {
    if (!keyed[entry.key]) keyed[entry.key] = entry;
  }

  const knowledge_status: Partial<Record<string, ObjectKnowledgeStatus>> = {};
  for (const [key, entry] of Object.entries(keyed)) {
    const status = knowledgeEntryStatus(entry);
    if (status) knowledge_status[key] = status;
  }

  const value = (key: string) => stringOrNull(keyed[key]?.value_text);

  return {
    object_id: objectId,
    object_name: value('object_name'),
    address: value('address'),
    directions_text: value('directions_text'),
    parking_text: value('parking_text'),
    trash_bins_location: value('trash_bins_location'),
    waste_disposal_text: value('waste_disposal_text'),
    wifi_name: value('wifi_name'),
    wifi_password: value('wifi_password'),
    baby_crib_available: entryBoolean(keyed.baby_crib_available),
    baby_crib_note: value('baby_crib_note'),
    check_in_text: value('check_in_text'),
    checkout_time: value('checkout_time') ?? value('checkout_rules'),
    house_rules_text: value('house_rules_text'),
    door_code_notes: value('door_code_notes'),
    knowledge_status,
  };
}

function mapBookingRow(row: any, chatId: number | null): TelegramGuestBookingV1 {
  const verified =
    Boolean(row?.access_verified) ||
    Boolean(row?.access_verified_at) ||
    (chatId !== null && Number(row?.chat_id) === chatId && Boolean(row?.guest_id));

  return {
    booking_id: stringOrNull(row?.booking_id) ?? String(row?.id ?? ''),
    reservation_id: String(row?.id ?? ''),
    guest_name: stringOrNull(row?.guest_name),
    guest_phone: normalizePhone(row?.guest_phone ?? row?.phone),
    telegram_chat_id: Number.isFinite(Number(row?.chat_id)) ? Number(row.chat_id) : null,
    object_id: stringOrNull(row?.property_id),
    check_in_date: stringOrNull(row?.check_in)?.slice(0, 10) ?? null,
    check_out_date: stringOrNull(row?.check_out)?.slice(0, 10) ?? null,
    status: stringOrNull(row?.status) ?? 'confirmed',
    access_verified: verified,
  };
}

export async function lookup_booking_by_telegram(params: {
  telegram_chat_id: number;
  telegram_user_id?: number | null;
  db?: SupabaseLike;
}): Promise<TelegramGuestBookingV1 | null> {
  const db = params.db ?? (supabase as unknown as SupabaseLike);
  const chatId = Number(params.telegram_chat_id);
  if (!Number.isFinite(chatId)) return null;

  const byChat = await maybeRows(
    db
      .from('tg_guest_reservations')
      .select('*')
      .eq('chat_id', chatId)
      .order('check_in', { ascending: false })
      .limit(3),
  );
  if (byChat.length >= 1) return mapBookingRow(byChat[0], chatId);

  const identity = await maybeOne(
    db
      .from('tg_guest_identities')
      .select('guest_id')
      .eq('telegram_chat_id', chatId)
      .limit(1),
  );
  if (!identity?.guest_id) return null;

  const byGuest = await maybeRows(
    db
      .from('tg_guest_reservations')
      .select('*')
      .eq('guest_id', String(identity.guest_id))
      .order('check_in', { ascending: false })
      .limit(3),
  );
  return byGuest[0] ? mapBookingRow(byGuest[0], chatId) : null;
}

export async function lookup_booking_by_identifier(params: {
  booking_id?: string | null;
  phone?: string | null;
  text?: string;
  db?: SupabaseLike;
}): Promise<TelegramGuestBookingV1 | null> {
  const db = params.db ?? (supabase as unknown as SupabaseLike);
  const bookingId = (params.booking_id ?? extractBookingIdFromTelegramText(params.text ?? '') ?? '').trim().toUpperCase();
  const phone = normalizePhone(params.phone) ?? extractPhoneFromTelegramText(params.text ?? '');

  if (bookingId) {
    let rows = await maybeRows(
      db.from('tg_guest_reservations').select('*').eq('id', bookingId).limit(2),
    );
    if (rows.length === 0) {
      rows = await maybeRows(
        db.from('tg_guest_reservations').select('*').eq('booking_id', bookingId).limit(2),
      );
    }
    if (rows.length === 1) return mapBookingRow(rows[0], null);
  }

  if (phone) {
    for (const col of ['phone', 'guest_phone'] as const) {
      const rows = await maybeRows(
        db.from('tg_guest_reservations').select('*').eq(col, phone).order('check_in', { ascending: false }).limit(3),
      );
      if (rows.length === 1) return mapBookingRow(rows[0], null);
    }
  }

  return null;
}

export async function lookup_booking_by_email(params: {
  email: string;
  db?: SupabaseLike;
}): Promise<TelegramGuestBookingV1 | null> {
  const email = normalizeGuestEmail(params.email);
  if (!email) return null;

  const db = params.db ?? (supabase as unknown as SupabaseLike);
  const identities = await maybeRows(
    db.from('tg_guest_identities').select('*').eq('email', email).limit(3),
  );

  for (const identity of identities) {
    const guestId = stringOrNull(identity?.guest_id);
    if (!guestId) continue;
    const rows = await maybeRows(
      db
        .from('tg_guest_reservations')
        .select('*')
        .eq('guest_id', guestId)
        .order('check_in', { ascending: false })
        .limit(3),
    );
    if (rows.length >= 1) return mapBookingRow(rows[0], null);
  }

  return null;
}

export async function lookup_property_by_booking(params: {
  booking: TelegramGuestBookingV1 | null | undefined;
  object_id?: string | null;
  db?: SupabaseLike;
}): Promise<TelegramPropertyObjectV1 | null> {
  const objectId = stringOrNull(params.object_id) ?? stringOrNull(params.booking?.object_id);
  if (!objectId) return null;

  const db = params.db ?? (supabase as unknown as SupabaseLike);
  const objectKnowledgeEntries = await get_object_knowledge_entries({
    object_id: objectId,
    keys: [...OBJECT_KNOWLEDGE_CONTEXT_KEYS],
    db,
  });
  const objectKnowledgeProperty = mapObjectKnowledgeEntriesToProperty(objectId, objectKnowledgeEntries);
  if (objectKnowledgeProperty) return objectKnowledgeProperty;

  const row = await maybeOne(
    db.from('tg_property_knowledge').select('*').eq('property_id', objectId).limit(1),
  );
  return row ? mapPropertyRow(row) : null;
}

export function get_property_directions(property: TelegramPropertyObjectV1 | null | undefined): {
  address: string | null;
  directions_text: string | null;
} {
  if (!property) return { address: null, directions_text: null };
  return {
    address: property.address,
    directions_text: property.directions_text,
  };
}

export function get_wifi_info_if_verified(params: {
  property: TelegramPropertyObjectV1 | null | undefined;
  verified: boolean;
}): { wifi_name: string | null; wifi_password: string | null } | null {
  if (!params.verified || !params.property) return null;
  const wifi_name = params.property.wifi_name;
  const wifi_password = params.property.wifi_password;
  if (!wifi_name && !wifi_password) return null;
  return { wifi_name, wifi_password };
}

export function buildGuestMissingContextReplyRu(): string {
  return 'Напишите, пожалуйста, номер бронирования, телефон или адрес объекта — найду нужную информацию.';
}

export function composeGuestDirectionsReplyRu(property: TelegramPropertyObjectV1 | null | undefined): string | null {
  if (!property) return null;
  const { address: addressRaw, directions_text: directionsRaw } = get_property_directions(property);
  if (!addressRaw && !directionsRaw) return null;
  if (isIncompleteOrTestAddress(addressRaw)) return null;

  const address = normalizeGuestAddress(addressRaw);
  const directions = directionsRaw ? localizePropertySnippet(directionsRaw) : null;
  const parts: string[] = [];
  if (address) parts.push(`Адрес: ${address}.`);
  if (directions) parts.push(`Как добраться: ${directions}`);
  if (!parts.length) return null;
  return sanitizeGuestFacingReply(parts.join(' '));
}

export function composeGuestWifiProblemReplyRu(
  wifiName?: string | null,
  options?: { messageText?: string; step?: WifiProblemStep; previousReply?: string | null; continuationUsed?: boolean },
): string {
  const messageText = options?.messageText ?? '';
  const subtype = detectWifiProblemSubtype(messageText, Boolean(options?.continuationUsed));
  return composeWifiProblemSubtypeReplyRu({
    subtype,
    wifiName,
    previousReply: options?.previousReply,
    continuationUsed: options?.continuationUsed,
  });
}

export function composeGuestWifiReplyRu(params: {
  property: TelegramPropertyObjectV1 | null | undefined;
  verified: boolean;
}): string {
  const wifi = get_wifi_info_if_verified(params);
  if (!wifi) {
    return 'Чтобы отправить данные Wi‑Fi, уточните номер бронирования или телефон из бронирования.';
  }
  const parts: string[] = [];
  if (wifi.wifi_name) parts.push(`Сеть: ${wifi.wifi_name}`);
  if (wifi.wifi_password) parts.push(`Пароль: ${wifi.wifi_password}`);
  return `Wi‑Fi: ${parts.join('. ')}.`;
}

export function composeGuestParkingReplyRu(property: TelegramPropertyObjectV1 | null | undefined): string | null {
  if (!property?.parking_text) return null;
  return `Парковка: ${property.parking_text}`;
}

function cautiousPrefix(status: ObjectKnowledgeStatus | undefined): string {
  if (status === 'stale' || status === 'low_confidence') return 'По последней информации: ';
  return '';
}

export function composeGuestWasteReplyRu(property: TelegramPropertyObjectV1 | null | undefined): string | null {
  const text = property?.trash_bins_location ?? property?.waste_disposal_text;
  if (!text) return null;
  const status = property?.knowledge_status?.trash_bins_location ?? property?.knowledge_status?.waste_disposal_text;
  return `${cautiousPrefix(status)}Мусор: ${text}`;
}

export function composeGuestBabyCribReplyRu(property: TelegramPropertyObjectV1 | null | undefined): string | null {
  if (!property) return null;
  const status = property.knowledge_status?.baby_crib_note ?? property.knowledge_status?.baby_crib_available;
  if (property.baby_crib_note) return `${cautiousPrefix(status)}Детская кроватка: ${property.baby_crib_note}`;
  if (property.baby_crib_available === true) return `${cautiousPrefix(status)}Детская кроватка есть.`;
  if (property.baby_crib_available === false) return `${cautiousPrefix(status)}Детская кроватка сейчас не указана как доступная.`;
  return null;
}

export function composeGuestCheckoutReplyRu(property: TelegramPropertyObjectV1 | null | undefined): string | null {
  if (!property?.checkout_time) return null;
  return `Выезд до ${property.checkout_time}. Ключи оставьте по инструкции из заселения.`;
}

export async function resolveTelegramGuestBookingObjectContext(params: {
  telegram_chat_id: number;
  text?: string;
  phone?: string | null;
  booking_id?: string | null;
  db?: SupabaseLike;
}): Promise<TelegramBookingObjectContextV1> {
  const db = params.db ?? (supabase as unknown as SupabaseLike);
  const chatId = Number(params.telegram_chat_id);

  const identity = await resolveTelegramGuestIdentityV1({
    telegram_chat_id: chatId,
    text: params.text,
    phone: params.phone,
    booking_id: params.booking_id,
    db,
  });

  let booking =
    (await lookup_booking_by_telegram({ telegram_chat_id: chatId, db })) ??
    (await lookup_booking_by_identifier({
      booking_id: params.booking_id ?? identity.booking_id,
      phone: params.phone ?? identity.phone,
      text: params.text,
      db,
    }));

  if (!booking && identity.current_reservation) {
    booking = {
      booking_id: identity.current_reservation.reservation_id,
      reservation_id: identity.current_reservation.reservation_id,
      guest_name: identity.current_reservation.guest_name,
      guest_phone: identity.phone,
      telegram_chat_id: chatId,
      object_id: identity.current_reservation.property_id,
      check_in_date: identity.current_reservation.check_in?.slice(0, 10) ?? null,
      check_out_date: identity.current_reservation.check_out?.slice(0, 10) ?? null,
      status: 'confirmed',
      access_verified: canRevealTelegramAccessDetails(identity),
    };
  }

  const property = await lookup_property_by_booking({ booking, db });
  const access_verified = canRevealTelegramAccessDetails(identity) || Boolean(booking?.access_verified);
  const booking_resolved = Boolean(booking);
  const property_resolved = Boolean(property);
  const wifi_verified = access_verified && property_resolved;

  let lookup_reason = 'no_match';
  if (booking && property) lookup_reason = 'booking_and_property';
  else if (booking) lookup_reason = 'booking_only';
  else if (property) lookup_reason = 'property_only';

  return {
    booking,
    property,
    identity,
    booking_resolved,
    property_resolved,
    access_verified,
    wifi_verified,
    lookup_reason,
  };
}

export async function resolveEmailGuestBookingObjectContext(params: {
  guest_email: string;
  text?: string;
  phone?: string | null;
  booking_id?: string | null;
  db?: SupabaseLike;
}): Promise<TelegramBookingObjectContextV1> {
  const db = params.db ?? (supabase as unknown as SupabaseLike);
  const senderEmail = normalizeGuestEmail(params.guest_email) ?? '';

  const identityRow = senderEmail
    ? await maybeOne(db.from('tg_guest_identities').select('*').eq('email', senderEmail).limit(1))
    : null;

  let booking =
    (senderEmail ? await lookup_booking_by_email({ email: senderEmail, db }) : null) ??
    (await lookup_booking_by_identifier({
      booking_id: params.booking_id ?? extractBookingIdFromTelegramText(params.text ?? ''),
      phone: params.phone ?? extractPhoneFromTelegramText(params.text ?? ''),
      text: params.text,
      db,
    }));

  if (!booking && identityRow?.guest_id) {
    const rows = await maybeRows(
      db
        .from('tg_guest_reservations')
        .select('*')
        .eq('guest_id', String(identityRow.guest_id))
        .order('check_in', { ascending: false })
        .limit(1),
    );
    if (rows[0]) booking = mapBookingRow(rows[0], null);
  }

  const property = await lookup_property_by_booking({ booking, db });
  const knownGuestEmail = stringOrNull(identityRow?.email) ?? senderEmail;
  const access_verified = canRevealEmailAccessDetails({
    senderEmail,
    booking,
    knownGuestEmail,
  });
  const booking_resolved = Boolean(booking);
  const property_resolved = Boolean(property);
  const wifi_verified = access_verified && property_resolved;

  let lookup_reason = 'no_match';
  if (booking && property) lookup_reason = 'booking_and_property';
  else if (booking) lookup_reason = 'booking_only';
  else if (property) lookup_reason = 'property_only';
  else if (senderEmail) lookup_reason = 'email_no_booking';

  return {
    booking,
    property,
    identity: null,
    booking_resolved,
    property_resolved,
    access_verified,
    wifi_verified,
    lookup_reason,
  };
}

export function bookingObjectContextToAutopilotFields(ctx: TelegramBookingObjectContextV1): {
  session?: { guestName?: string };
  booking?: {
    id?: string;
    checkInDate?: string;
    checkInTime?: string;
    checkoutTime?: string;
    verified?: boolean;
  };
  object?: {
    id?: string;
    name?: string;
    address?: string;
    directionsText?: string;
    parkingText?: string;
    trashBinsLocation?: string;
    wasteDisposalText?: string;
    accessInstructions?: string;
    accessCode?: string;
    wifiName?: string;
    wifiPassword?: string;
    babyCribAvailable?: boolean;
    babyCribNote?: string;
    houseRules?: string;
    knowledgeStatus?: Partial<Record<string, ObjectKnowledgeStatus>>;
  };
  bookingVerified?: boolean;
  propertyResolved?: boolean;
} {
  const property = ctx.property;
  const booking = ctx.booking;

  return {
    session: booking?.guest_name ? { guestName: booking.guest_name } : undefined,
    booking: booking
      ? {
          id: booking.booking_id || booking.reservation_id,
          checkInDate: booking.check_in_date ?? undefined,
          checkoutTime: property?.checkout_time ?? undefined,
          verified: ctx.access_verified,
        }
      : undefined,
    object: property
      ? {
          id: property.object_id,
          name: property.object_name ?? undefined,
          address: property.address ?? undefined,
          directionsText: property.directions_text ?? undefined,
          parkingText: property.parking_text ?? undefined,
          trashBinsLocation: property.trash_bins_location ?? undefined,
          wasteDisposalText: property.waste_disposal_text ?? undefined,
          accessInstructions: property.check_in_text ?? property.directions_text ?? undefined,
          accessCode: ctx.access_verified ? (property.door_code_notes ?? undefined) : undefined,
          wifiName: property.wifi_name ?? undefined,
          wifiPassword: property.wifi_password ?? undefined,
          babyCribAvailable: property.baby_crib_available ?? undefined,
          babyCribNote: property.baby_crib_note ?? undefined,
          houseRules: property.house_rules_text ?? undefined,
          knowledgeStatus: property.knowledge_status,
        }
      : undefined,
    bookingVerified: ctx.wifi_verified,
    propertyResolved: ctx.property_resolved,
  };
}
