import { supabase } from '@/lib/supabase';

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
};

type SupabaseLike = { from: (table: string) => any };

const KNOWLEDGE_FIELD_KEYS: (keyof TelegramPropertyKnowledgeFields)[] = [
  'wifi_name',
  'wifi_password',
  'wifi_notes',
  'checkin_instructions',
  'door_code_notes',
  'access_notes',
  'parking_rules',
  'parking_paid_or_free',
  'parking_location_notes',
  'quiet_hours',
  'house_rules',
  'heating_notes',
  'emergency_contact_notes',
  'checkout_notes',
  'late_checkout_policy',
  'early_checkin_policy',
  'timezone',
];

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

function mapRowToKnowledge(row: any): { fields: TelegramPropertyKnowledgeFields; available: string[] } {
  const fields = emptyKnowledge();
  const available: string[] = [];
  for (const key of KNOWLEDGE_FIELD_KEYS) {
    const v = stringOrNull((row ?? {})[key]);
    if (v) {
      fields[key] = v;
      available.push(key);
    }
  }
  // Legacy compatibility: some rows still use wifi_instructions combined field.
  if (!fields.wifi_notes) {
    const legacy = stringOrNull((row ?? {}).wifi_instructions);
    if (legacy) {
      fields.wifi_notes = legacy;
      available.push('wifi_notes');
    }
  }
  return { fields, available };
}

/**
 * Load property knowledge by matched_property_id. Deterministic, no LLM.
 *
 * Returns a normalized result with one of:
 *  - knowledge_found (row exists and at least one knowledge field is populated)
 *  - property_found_but_knowledge_missing (row exists but all fields empty)
 *  - property_not_found (no row)
 */
export async function loadTelegramPropertyKnowledgeV1(params: {
  matched_property_id: string | null | undefined;
  db?: SupabaseLike;
}): Promise<TelegramPropertyKnowledgeLookupResultV1> {
  const propertyId = params.matched_property_id ? String(params.matched_property_id).trim() : '';
  if (!propertyId) {
    return {
      status: 'property_not_found',
      property_id: null,
      knowledge: emptyKnowledge(),
      available_fields: [],
    };
  }

  const db = (params.db ?? (supabase as unknown as SupabaseLike));

  try {
    const { data, error } = await db
      .from('tg_property_knowledge')
      .select('*')
      .eq('property_id', propertyId)
      .maybeSingle();

    if (error || !data) {
      return {
        status: 'property_not_found',
        property_id: propertyId,
        knowledge: emptyKnowledge(),
        available_fields: [],
      };
    }

    const { fields, available } = mapRowToKnowledge(data);
    if (available.length === 0) {
      return {
        status: 'property_found_but_knowledge_missing',
        property_id: propertyId,
        knowledge: fields,
        available_fields: [],
      };
    }
    return {
      status: 'knowledge_found',
      property_id: propertyId,
      knowledge: fields,
      available_fields: available,
    };
  } catch {
    return {
      status: 'property_not_found',
      property_id: propertyId,
      knowledge: emptyKnowledge(),
      available_fields: [],
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
