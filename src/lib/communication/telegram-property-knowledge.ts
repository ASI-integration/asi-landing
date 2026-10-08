import { supabase } from '@/lib/supabase';
import {
  resolveGuestPropertyKnowledge,
  type GuestFactFieldResolution,
  type GuestFactSource,
} from './guest-property-knowledge';

export type TelegramPropertyKnowledgeLookupStatus =
  | 'knowledge_found'
  | 'property_found_but_knowledge_missing'
  | 'property_not_found';

export type TelegramPropertyKnowledgeFields = {
  wifi_name: string | null;
  wifi_password: string | null;
  wifi_notes: string | null;
  checkin_instructions: string | null;
  door_code_notes: string | null;
  access_notes: string | null;
  parking_rules: string | null;
  parking_paid_or_free: string | null;
  parking_location_notes: string | null;
  quiet_hours: string | null;
  house_rules: string | null;
  heating_notes: string | null;
  emergency_contact_notes: string | null;
  checkout_notes: string | null;
  late_checkout_policy: string | null;
  early_checkin_policy: string | null;
  timezone: string | null;
};

export type TelegramPropertyKnowledgeLookupResultV1 = {
  status: TelegramPropertyKnowledgeLookupStatus;
  property_id: string | null;
  knowledge: TelegramPropertyKnowledgeFields;
  available_fields: string[];
  /** P0-02: per-field resolution (canonical vs legacy_adapter). */
  field_resolutions?: GuestFactFieldResolution[];
  /** Aggregate source hint for audit/logging. */
  knowledge_source?: GuestFactSource | 'mixed';
};

type SupabaseLike = { from: (table: string) => any };

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

function aggregateSource(resolutions: GuestFactFieldResolution[]): GuestFactSource | 'mixed' {
  const used = new Set(
    resolutions.filter((r) => r.usable || r.source !== 'none').map((r) => r.source),
  );
  used.delete('none');
  if (used.size === 0) return 'none';
  if (used.size === 1) return [...used][0]!;
  return 'mixed';
}

/**
 * Load guest-facing property facts by matched_property_id.
 *
 * P0-02: compatibility facade — guest facts resolve through canonical
 * `object_knowledge_entries` (with explicit legacy adapter when no canonical
 * entry exists for a key). Telegram callers must not query both stores.
 *
 * Returns a normalized result with one of:
 *  - knowledge_found (at least one usable guest-facing field)
 *  - property_found_but_knowledge_missing (property known but no usable facts)
 *  - property_not_found (no canonical entries and no legacy row)
 */
export async function loadTelegramPropertyKnowledgeV1(params: {
  matched_property_id: string | null | undefined;
  booking_verified?: boolean;
  db?: SupabaseLike;
  audit_message_id?: string;
  now?: Date;
}): Promise<TelegramPropertyKnowledgeLookupResultV1> {
  const propertyId = params.matched_property_id ? String(params.matched_property_id).trim() : '';
  if (!propertyId) {
    return {
      status: 'property_not_found',
      property_id: null,
      knowledge: emptyKnowledge(),
      available_fields: [],
      field_resolutions: [],
      knowledge_source: 'none',
    };
  }

  const db = params.db ?? (supabase as unknown as SupabaseLike);

  try {
    const resolved = await resolveGuestPropertyKnowledge({
      property_id: propertyId,
      booking_verified: Boolean(params.booking_verified),
      db,
      now: params.now,
      audit_message_id: params.audit_message_id,
    });

    const knowledge_source = aggregateSource(resolved.field_resolutions);
    const propertyKnown =
      resolved.has_canonical_guest_entries ||
      resolved.has_legacy_row ||
      resolved.available_fields.length > 0;

    if (resolved.available_fields.length > 0) {
      return {
        status: 'knowledge_found',
        property_id: propertyId,
        knowledge: resolved.knowledge,
        available_fields: resolved.available_fields,
        field_resolutions: resolved.field_resolutions,
        knowledge_source,
      };
    }

    if (propertyKnown) {
      return {
        status: 'property_found_but_knowledge_missing',
        property_id: propertyId,
        knowledge: resolved.knowledge,
        available_fields: [],
        field_resolutions: resolved.field_resolutions,
        knowledge_source,
      };
    }

    return {
      status: 'property_not_found',
      property_id: propertyId,
      knowledge: emptyKnowledge(),
      available_fields: [],
      field_resolutions: resolved.field_resolutions,
      knowledge_source: 'none',
    };
  } catch {
    return {
      status: 'property_not_found',
      property_id: propertyId,
      knowledge: emptyKnowledge(),
      available_fields: [],
      field_resolutions: [],
      knowledge_source: 'none',
    };
  }
}

/** Load IANA timezone for a property from tg_property_knowledge. */
export async function loadPropertyTimezone(propertyId: string | null | undefined): Promise<string | null> {
  const id = propertyId ? String(propertyId).trim() : '';
  if (!id) return null;

  const db = supabase as unknown as SupabaseLike;
  try {
    const { data, error } = await db
      .from('tg_property_knowledge')
      .select('timezone')
      .eq('property_id', id)
      .maybeSingle();
    if (error || !data) return null;
    const tz = stringOrNull((data as { timezone?: unknown }).timezone);
    return tz;
  } catch {
    return null;
  }
}

export function logTelegramPropertyKnowledgeLookup(params: {
  update_id: number;
  chat_id: number;
  scenario: string;
  matched_property_id: string | null;
  property_match_confidence: string | null;
  knowledge_lookup_attempted: boolean;
  knowledge_lookup_result: TelegramPropertyKnowledgeLookupStatus | 'skipped';
  knowledge_fields_available: string[];
  reply_used_grounded_property_data: boolean;
  clarification_question_used: boolean;
  escalated: boolean;
  reason: string;
}): void {
  try {
    console.log(
      JSON.stringify({
        route: 'telegram_property_knowledge_lookup',
        scenario: params.scenario,
        update_id: `tg:${params.chat_id}:${params.update_id}`,
        matched_property_id: params.matched_property_id,
        property_match_confidence: params.property_match_confidence,
        knowledge_lookup_attempted: params.knowledge_lookup_attempted,
        knowledge_lookup_result: params.knowledge_lookup_result,
        knowledge_fields_available: params.knowledge_fields_available,
        reply_used_grounded_property_data: params.reply_used_grounded_property_data,
        clarification_question_used: params.clarification_question_used,
        escalated: params.escalated,
        reason: params.reason,
      }),
    );
  } catch {
    // never throw from logging
  }
}
