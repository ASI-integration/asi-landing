/**
 * P0-02: Canonical guest-fact resolution for live Telegram Path A.
 *
 * SSOT: object_knowledge_entries via object-knowledge.ts
 * Legacy: tg_property_knowledge only as an explicit per-key adapter when no
 * canonical entry exists for that key. Canonical found/stale/low_confidence/
 * blocked_sensitive/missing (including explicit clears) never falls back to legacy.
 */

import {
  audit_object_knowledge_reply,
  get_guest_visible_knowledge,
  get_object_knowledge_entries,
  type ObjectKnowledgeConfidence,
  type ObjectKnowledgeEntry,
  type ObjectKnowledgeStatus,
} from './object-knowledge';
import {
  canRevealTelegramAccessDetails,
  type TelegramGuestIdentityResolutionV1,
} from './telegram-guest-memory';
import type { TelegramPropertyKnowledgeFields } from './telegram-property-knowledge';

type SupabaseLike = { from: (table: string) => any };

/** Unified access class — canonical writes and legacy reads must not drift. */
export type GuestFactAccessClass = 'booking_gated' | 'guest_public';

/**
 * ONE explicit guest-fact access policy.
 * Legacy adapter must be at least as restrictive as this contract.
 */
export const GUEST_FACT_ACCESS_POLICY: Record<keyof TelegramPropertyKnowledgeFields, GuestFactAccessClass> = {
  wifi_name: 'booking_gated',
  wifi_password: 'booking_gated',
  wifi_notes: 'guest_public',
  checkin_instructions: 'booking_gated',
  door_code_notes: 'booking_gated',
  access_notes: 'booking_gated',
  parking_rules: 'guest_public',
  parking_paid_or_free: 'guest_public',
  parking_location_notes: 'guest_public',
  quiet_hours: 'guest_public',
  house_rules: 'guest_public',
  heating_notes: 'guest_public',
  emergency_contact_notes: 'guest_public',
  checkout_notes: 'guest_public',
  late_checkout_policy: 'guest_public',
  early_checkin_policy: 'guest_public',
  timezone: 'guest_public',
};

export function guestFactRequiresBookingVerification(
  field: keyof TelegramPropertyKnowledgeFields,
): boolean {
  return GUEST_FACT_ACCESS_POLICY[field] === 'booking_gated';
}

/** Guest-facing Telegram fields → ordered canonical object_knowledge keys (first wins). */
export const GUEST_FACT_CANONICAL_KEYS: Record<keyof TelegramPropertyKnowledgeFields, readonly string[]> = {
  wifi_name: ['wifi_name'],
  wifi_password: ['wifi_password'],
  wifi_notes: ['wifi_notes'],
  checkin_instructions: ['check_in_text'],
  door_code_notes: ['door_code_notes'],
  access_notes: ['directions_text'],
  parking_rules: ['parking_text'],
  parking_paid_or_free: [],
  parking_location_notes: [],
  quiet_hours: ['quiet_hours'],
  house_rules: ['house_rules_text'],
  heating_notes: ['heating_notes'],
  emergency_contact_notes: ['emergency_contact_notes'],
  checkout_notes: ['checkout_time', 'checkout_rules'],
  late_checkout_policy: ['late_checkout_policy'],
  early_checkin_policy: ['early_checkin_policy'],
  timezone: [],
};

/** All canonical keys used for guest-fact batch load. */
export const GUEST_FACT_CANONICAL_KEY_LIST: string[] = Array.from(
  new Set(Object.values(GUEST_FACT_CANONICAL_KEYS).flat()),
);

export type GuestFactSource = 'canonical' | 'legacy_adapter' | 'none';

export type GuestFactFieldResolution = {
  field: keyof TelegramPropertyKnowledgeFields;
  canonical_key: string | null;
  status: ObjectKnowledgeStatus | 'legacy_found' | 'absent';
  source: GuestFactSource;
  /** True when a usable guest-facing value is present (never for blocked/stale/low/missing). */
  usable: boolean;
};

export type GuestPropertyKnowledgeResolution = {
  knowledge: TelegramPropertyKnowledgeFields;
  available_fields: string[];
  field_resolutions: GuestFactFieldResolution[];
  has_canonical_guest_entries: boolean;
  /** True when a tg_property_knowledge row exists (even if empty). */
  has_legacy_row: boolean;
};

type CanonicalWriteMeta = {
  key: string;
  category: string;
  visibility: 'guest_public' | 'guest_after_booking_verified';
  sensitivity: 'normal' | 'password' | 'access_code';
};

function visibilityForAccessClass(access: GuestFactAccessClass): CanonicalWriteMeta['visibility'] {
  return access === 'booking_gated' ? 'guest_after_booking_verified' : 'guest_public';
}

/** Shared write mapping: Telegram/admin guest fields → canonical object_knowledge keys. */
export const LEGACY_FIELD_TO_CANONICAL_WRITE: Partial<
  Record<
    keyof TelegramPropertyKnowledgeFields | 'parking_instructions' | 'check_out_time' | 'check_in_instructions',
    CanonicalWriteMeta
  >
> = {
  wifi_name: {
    key: 'wifi_name',
    category: 'wifi',
    visibility: visibilityForAccessClass('booking_gated'),
    sensitivity: 'normal',
  },
  wifi_password: {
    key: 'wifi_password',
    category: 'wifi',
    visibility: visibilityForAccessClass('booking_gated'),
    sensitivity: 'password',
  },
  wifi_notes: {
    key: 'wifi_notes',
    category: 'wifi',
    visibility: visibilityForAccessClass('guest_public'),
    sensitivity: 'normal',
  },
  checkin_instructions: {
    key: 'check_in_text',
    category: 'access',
    visibility: visibilityForAccessClass('booking_gated'),
    sensitivity: 'normal',
  },
  check_in_instructions: {
    key: 'check_in_text',
    category: 'access',
    visibility: visibilityForAccessClass('booking_gated'),
    sensitivity: 'normal',
  },
  door_code_notes: {
    key: 'door_code_notes',
    category: 'access',
    visibility: visibilityForAccessClass('booking_gated'),
    sensitivity: 'access_code',
  },
  access_notes: {
    key: 'directions_text',
    category: 'directions',
    visibility: visibilityForAccessClass('booking_gated'),
    sensitivity: 'normal',
  },
  parking_rules: {
    key: 'parking_text',
    category: 'parking',
    visibility: visibilityForAccessClass('guest_public'),
    sensitivity: 'normal',
  },
  parking_instructions: {
    key: 'parking_text',
    category: 'parking',
    visibility: visibilityForAccessClass('guest_public'),
    sensitivity: 'normal',
  },
  quiet_hours: {
    key: 'quiet_hours',
    category: 'house_rules',
    visibility: visibilityForAccessClass('guest_public'),
    sensitivity: 'normal',
  },
  house_rules: {
    key: 'house_rules_text',
    category: 'house_rules',
    visibility: visibilityForAccessClass('guest_public'),
    sensitivity: 'normal',
  },
  checkout_notes: {
    key: 'checkout_time',
    category: 'checkout',
    visibility: visibilityForAccessClass('guest_public'),
    sensitivity: 'normal',
  },
  check_out_time: {
    key: 'checkout_time',
    category: 'checkout',
    visibility: visibilityForAccessClass('guest_public'),
    sensitivity: 'normal',
  },
  late_checkout_policy: {
    key: 'late_checkout_policy',
    category: 'checkout',
    visibility: visibilityForAccessClass('guest_public'),
    sensitivity: 'normal',
  },
  early_checkin_policy: {
    key: 'early_checkin_policy',
    category: 'access',
    visibility: visibilityForAccessClass('guest_public'),
    sensitivity: 'normal',
  },
};

export type CanonicalGuestFactUpsertRow = {
  object_id: string;
  property_id: string;
  category: string;
  key: string;
  /** null = explicit clear/tombstone (blocks legacy fallback for this key). */
  value_text: string | null;
  visibility: string;
  sensitivity: string;
  source_type: 'system';
  confidence: 'high';
  last_verified_at: string;
  updated_at: string;
  updated_by: string;
};

/** Admin/request field names that map to guest-facing canonical keys. */
export const GUEST_FACING_ADMIN_FIELDS = [
  'wifi_name',
  'wifi_password',
  'wifi_notes',
  'check_in_instructions',
  'checkin_instructions',
  'check_out_instructions',
  'checkout_notes',
  'check_out_time',
  'house_rules',
  'parking_instructions',
  'parking_rules',
  'door_code_notes',
  'access_notes',
  'quiet_hours',
  'late_checkout_policy',
  'early_checkin_policy',
] as const;

export function adminPayloadHasGuestFacingFields(fields: Record<string, unknown>): boolean {
  return GUEST_FACING_ADMIN_FIELDS.some((field) => field in fields && fields[field] !== undefined);
}

/**
 * Build canonical object_knowledge_entries rows from admin/legacy field payloads.
 *
 * Semantics:
 * - field omitted → no change (not included)
 * - field supplied non-empty → canonical upsert with value
 * - field supplied blank/null → canonical explicit clear (value_text null tombstone)
 *
 * One canonical key per fact; later duplicate keys in the same payload are ignored.
 */
export function buildCanonicalGuestFactUpserts(params: {
  property_id: string;
  fields: Record<string, unknown>;
  now?: Date;
  updated_by?: string;
}): CanonicalGuestFactUpsertRow[] {
  const propertyId = String(params.property_id ?? '').trim();
  if (!propertyId) return [];
  const nowIso = (params.now ?? new Date()).toISOString();
  const updatedBy = params.updated_by ?? 'admin_upsert_property_knowledge';
  const seen = new Set<string>();
  const rows: CanonicalGuestFactUpsertRow[] = [];

  for (const [field, meta] of Object.entries(LEGACY_FIELD_TO_CANONICAL_WRITE)) {
    if (!meta) continue;
    if (!(field in params.fields) || params.fields[field] === undefined) continue;
    if (seen.has(meta.key)) continue;
    seen.add(meta.key);
    const raw = params.fields[field];
    const value = stringOrNull(raw);
    // Explicit null/blank → tombstone clear (preserve key presence).
    rows.push({
      object_id: propertyId,
      property_id: propertyId,
      category: meta.category,
      key: meta.key,
      value_text: value,
      visibility: meta.visibility,
      sensitivity: meta.sensitivity,
      source_type: 'system',
      confidence: 'high',
      last_verified_at: nowIso,
      updated_at: nowIso,
      updated_by: updatedBy,
    });
  }
  return rows;
}

/**
 * Authorization for revealing booking-gated guest facts.
 * Routing match (name/address/reservation lookup) is NOT sufficient.
 */
export function isBookingVerifiedForGuestKnowledge(params: {
  guestIdentity: TelegramGuestIdentityResolutionV1 | null | undefined;
  matchedPropertyId: string | null | undefined;
  matchedReservationId?: string | null | undefined;
}): boolean {
  const identity = params.guestIdentity;
  if (!canRevealTelegramAccessDetails(identity)) return false;

  const verifiedReservation = identity?.current_reservation;
  if (!verifiedReservation?.reservation_id) return false;

  const matchedPropertyId = String(params.matchedPropertyId ?? '').trim();
  if (!matchedPropertyId) return false;
  if (String(verifiedReservation.property_id ?? '').trim() !== matchedPropertyId) return false;

  const matchedReservationId = params.matchedReservationId
    ? String(params.matchedReservationId).trim()
    : '';
  if (
    matchedReservationId &&
    matchedReservationId !== String(verifiedReservation.reservation_id).trim()
  ) {
    return false;
  }

  return true;
}

function emptyKnowledge(): TelegramPropertyKnowledgeFields {
  return {
    wifi_name: null,
    wifi_password: null,
    wifi_notes: null,
    checkin_instructions: null,
    door_code_notes: null,
    access_notes: null,
    parking_rules: null,
    parking_paid_or_free: null,
    parking_location_notes: null,
    quiet_hours: null,
    house_rules: null,
    heating_notes: null,
    emergency_contact_notes: null,
    checkout_notes: null,
    late_checkout_policy: null,
    early_checkin_policy: null,
    timezone: null,
  };
}

function stringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}

/**
 * Map legacy tg_property_knowledge row → Telegram fields.
 *
 * Intentionally does NOT promote combined `wifi_instructions` into guest-public
 * `wifi_notes` (that field often embeds SSID+password and would leak secrets).
 */
function mapLegacyRow(row: any): TelegramPropertyKnowledgeFields {
  const fields = emptyKnowledge();
  for (const key of Object.keys(fields) as (keyof TelegramPropertyKnowledgeFields)[]) {
    fields[key] = stringOrNull(row?.[key]);
  }
  if (!fields.checkin_instructions) {
    fields.checkin_instructions = stringOrNull(row?.check_in_text);
  }
  if (!fields.house_rules) {
    fields.house_rules = stringOrNull(row?.house_rules_text);
  }
  if (!fields.parking_rules) {
    fields.parking_rules = stringOrNull(row?.parking_text) ?? stringOrNull(row?.parking_instructions);
  }
  if (!fields.checkout_notes) {
    fields.checkout_notes = stringOrNull(row?.checkout_time) ?? stringOrNull(row?.check_out_time);
  }
  return fields;
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

async function loadLegacyRow(propertyId: string, db: SupabaseLike): Promise<any | null> {
  const rows = await maybeRows(
    db.from('tg_property_knowledge').select('*').eq('property_id', propertyId).limit(1),
  );
  return rows[0] ?? null;
}

function pickCanonicalEntry(
  keyed: Map<string, ObjectKnowledgeEntry>,
  canonicalKeys: readonly string[],
): { key: string; entry: ObjectKnowledgeEntry } | null {
  for (const key of canonicalKeys) {
    const entry = keyed.get(key);
    if (entry) return { key, entry };
  }
  return null;
}

function auditGuestFact(params: {
  audit_message_id?: string;
  object_id: string;
  field: keyof TelegramPropertyKnowledgeFields;
  knowledge_key: string;
  status: ObjectKnowledgeStatus;
  usable: boolean;
  source_type?: ObjectKnowledgeEntry['source_type'] | null;
  confidence?: ObjectKnowledgeConfidence | null;
  last_verified_at?: string | null;
  value?: string | null;
}): void {
  if (!params.audit_message_id) return;
  audit_object_knowledge_reply({
    message_id: params.audit_message_id,
    object_id: params.object_id,
    intent: `guest_fact:${params.field}`,
    knowledge_key: params.knowledge_key,
    knowledge_found:
      params.status === 'found' ||
      params.status === 'stale' ||
      params.status === 'low_confidence' ||
      params.status === 'blocked_sensitive',
    knowledge_status: params.status,
    source_type: params.source_type ?? null,
    confidence: params.confidence ?? null,
    last_verified_at: params.last_verified_at ?? null,
    reply_source: params.usable
      ? 'object_knowledge'
      : params.status === 'missing'
        ? 'fallback'
        : 'operator_review',
    guest_reply_redacted:
      params.usable &&
      params.field !== 'wifi_password' &&
      params.field !== 'door_code_notes' &&
      !guestFactRequiresBookingVerification(params.field)
        ? params.value ?? null
        : null,
  });
}

/**
 * Resolve guest-facing property facts with canonical-first precedence.
 *
 * - If a canonical entry exists for a key (including empty tombstone): never legacy for that key.
 * - If no canonical entry for a key: optional legacy_adapter value under unified access policy.
 * - Booking-gated facts require booking_verified (identity-bound at the live seam).
 */
export async function resolveGuestPropertyKnowledge(params: {
  property_id: string;
  booking_verified?: boolean;
  db: SupabaseLike;
  now?: Date;
  audit_message_id?: string;
}): Promise<GuestPropertyKnowledgeResolution> {
  const propertyId = String(params.property_id ?? '').trim();
  const bookingVerified = Boolean(params.booking_verified);
  const knowledge = emptyKnowledge();
  const field_resolutions: GuestFactFieldResolution[] = [];
  const available_fields: string[] = [];

  if (!propertyId) {
    return {
      knowledge,
      available_fields,
      field_resolutions,
      has_canonical_guest_entries: false,
      has_legacy_row: false,
    };
  }

  const entries = await get_object_knowledge_entries({
    object_id: propertyId,
    keys: GUEST_FACT_CANONICAL_KEY_LIST,
    db: params.db,
  });
  const keyed = new Map<string, ObjectKnowledgeEntry>();
  for (const entry of entries) {
    if (!keyed.has(entry.key)) keyed.set(entry.key, entry);
  }
  const has_canonical_guest_entries = keyed.size > 0;

  const legacyRow = await loadLegacyRow(propertyId, params.db);
  const has_legacy_row = Boolean(legacyRow);
  const legacyFields = legacyRow ? mapLegacyRow(legacyRow) : emptyKnowledge();

  for (const field of Object.keys(GUEST_FACT_CANONICAL_KEYS) as (keyof TelegramPropertyKnowledgeFields)[]) {
    const canonicalKeys = GUEST_FACT_CANONICAL_KEYS[field];
    const picked = pickCanonicalEntry(keyed, canonicalKeys);

    if (picked) {
      // Explicit clear / empty tombstone: block legacy fallback; treat as missing.
      if (!stringOrNull(picked.entry.value_text)) {
        knowledge[field] = null;
        field_resolutions.push({
          field,
          canonical_key: picked.key,
          status: 'missing',
          source: 'canonical',
          usable: false,
        });
        auditGuestFact({
          audit_message_id: params.audit_message_id,
          object_id: propertyId,
          field,
          knowledge_key: picked.key,
          status: 'missing',
          usable: false,
          source_type: picked.entry.source_type,
          confidence: picked.entry.confidence,
          last_verified_at: picked.entry.last_verified_at ?? null,
        });
        continue;
      }

      const gated = await get_guest_visible_knowledge({
        object_id: propertyId,
        key: picked.key,
        booking_verified: bookingVerified,
        db: params.db,
        now: params.now,
      });
      const status = gated.status;
      const usable = status === 'found' && Boolean(stringOrNull(gated.entry?.value_text));
      const value = usable ? stringOrNull(gated.entry?.value_text) : null;
      knowledge[field] = value;
      if (usable && value) available_fields.push(field);
      field_resolutions.push({
        field,
        canonical_key: picked.key,
        status,
        source: 'canonical',
        usable,
      });
      auditGuestFact({
        audit_message_id: params.audit_message_id,
        object_id: propertyId,
        field,
        knowledge_key: picked.key,
        status,
        usable,
        source_type: gated.entry?.source_type ?? null,
        confidence: (gated.entry?.confidence ?? null) as ObjectKnowledgeConfidence | null,
        last_verified_at: gated.entry?.last_verified_at ?? null,
        value,
      });
      continue;
    }

    // No canonical entry for this field → explicit legacy adapter (never invent).
    const legacyValue = legacyFields[field];
    if (legacyValue) {
      const bookingGated = guestFactRequiresBookingVerification(field);
      if (bookingGated && !bookingVerified) {
        knowledge[field] = null;
        field_resolutions.push({
          field,
          canonical_key: null,
          status: 'blocked_sensitive',
          source: 'legacy_adapter',
          usable: false,
        });
        auditGuestFact({
          audit_message_id: params.audit_message_id,
          object_id: propertyId,
          field,
          knowledge_key: field,
          status: 'blocked_sensitive',
          usable: false,
          source_type: 'system',
          confidence: 'unknown',
        });
      } else {
        knowledge[field] = legacyValue;
        available_fields.push(field);
        field_resolutions.push({
          field,
          canonical_key: null,
          status: 'legacy_found',
          source: 'legacy_adapter',
          usable: true,
        });
        auditGuestFact({
          audit_message_id: params.audit_message_id,
          object_id: propertyId,
          field,
          knowledge_key: field,
          status: 'found',
          usable: true,
          source_type: 'system',
          confidence: 'unknown',
          value: bookingGated ? null : legacyValue,
        });
      }
      continue;
    }

    knowledge[field] = null;
    field_resolutions.push({
      field,
      canonical_key: canonicalKeys[0] ?? null,
      status: 'absent',
      source: 'none',
      usable: false,
    });
  }

  return {
    knowledge,
    available_fields,
    field_resolutions,
    has_canonical_guest_entries,
    has_legacy_row,
  };
}
