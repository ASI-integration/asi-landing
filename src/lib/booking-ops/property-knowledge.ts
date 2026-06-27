import { supabase } from '@/lib/supabase';
import type {
  BookingOpsPropertyKnowledge,
  PropertyKnowledgeMatch,
} from './types';

type SupabaseLike = { from: (table: string) => any };

type PropertyKnowledgeRow = Record<string, unknown> & {
  property_id?: unknown;
  object_name?: unknown;
  updated_at?: unknown;
};

export type PropertyKnowledgeInput = {
  propertyId: string;
  propertyLabel?: string | null;
  address?: string | null;
  entranceInstructions?: string | null;
  floorApartment?: string | null;
  intercomCode?: string | null;
  keyPickupInstructions?: string | null;
  wifiName?: string | null;
  wifiPassword?: string | null;
  parkingInstructions?: string | null;
  houseRules?: string | null;
  quietHours?: string | null;
  checkoutInstructions?: string | null;
  emergencyInstructions?: string | null;
  cleaningLinenNotes?: string | null;
  publicGuestNotes?: string | null;
  privateOperatorNotes?: string | null;
};

export type PropertyKnowledgeLookup = {
  knowledge: BookingOpsPropertyKnowledge | null;
  match: PropertyKnowledgeMatch;
  error?: string;
};

const PROPERTY_KNOWLEDGE_SELECT = [
  'property_id',
  'object_name',
  'location',
  'address',
  'entrance_instructions',
  'check_in_instructions',
  'check_in_text',
  'floor_apartment',
  'intercom_code',
  'key_pickup_instructions',
  'key_instructions',
  'wifi_name',
  'wifi_password',
  'parking_instructions',
  'parking_text',
  'house_rules',
  'house_rules_text',
  'quiet_hours',
  'checkout_instructions',
  'check_out_instructions',
  'emergency_instructions',
  'emergency_contacts',
  'escalation_contact_text',
  'cleaning_linen_notes',
  'public_guest_notes',
  'private_operator_notes',
  'updated_at',
].join(',');

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = text(value);
    if (normalized) return normalized;
  }
  return null;
}

export function mapPropertyKnowledgeRow(row: PropertyKnowledgeRow): BookingOpsPropertyKnowledge {
  return {
    propertyId: text(row.property_id) ?? '',
    propertyLabel: firstText(row.object_name, row.location),
    address: firstText(row.address, row.location),
    entranceInstructions: firstText(
      row.entrance_instructions,
      row.check_in_instructions,
      row.check_in_text,
    ),
    floorApartment: text(row.floor_apartment),
    intercomCode: text(row.intercom_code),
    keyPickupInstructions: firstText(row.key_pickup_instructions, row.key_instructions),
    wifiName: text(row.wifi_name),
    wifiPassword: text(row.wifi_password),
    parkingInstructions: firstText(row.parking_instructions, row.parking_text),
    houseRules: firstText(row.house_rules, row.house_rules_text),
    quietHours: text(row.quiet_hours),
    checkoutInstructions: firstText(row.checkout_instructions, row.check_out_instructions),
    emergencyInstructions: firstText(
      row.emergency_instructions,
      row.emergency_contacts,
      row.escalation_contact_text,
    ),
    cleaningLinenNotes: text(row.cleaning_linen_notes),
    publicGuestNotes: text(row.public_guest_notes),
    privateOperatorNotes: text(row.private_operator_notes),
    updatedAt: text(row.updated_at),
  };
}

export async function lookupPropertyKnowledge(
  input: { propertyId?: string | null; propertyLabel?: string | null },
  db: SupabaseLike = supabase,
): Promise<PropertyKnowledgeLookup> {
  const propertyId = text(input.propertyId);
  if (propertyId) {
    const { data, error } = await db
      .from('tg_property_knowledge')
      .select(PROPERTY_KNOWLEDGE_SELECT)
      .eq('property_id', propertyId)
      .maybeSingle();
    if (error) return { knowledge: null, match: 'error', error: error.message };
    if (data) return { knowledge: mapPropertyKnowledgeRow(data), match: 'property_id' };
  }

  const propertyLabel = text(input.propertyLabel);
  if (!propertyLabel) return { knowledge: null, match: 'none' };

  const { data, error } = await db
    .from('tg_property_knowledge')
    .select(PROPERTY_KNOWLEDGE_SELECT)
    .eq('object_name', propertyLabel)
    .limit(2);
  if (error) return { knowledge: null, match: 'error', error: error.message };
  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) return { knowledge: null, match: 'none' };
  if (rows.length > 1) return { knowledge: null, match: 'ambiguous' };
  return { knowledge: mapPropertyKnowledgeRow(rows[0]), match: 'property_label' };
}

export async function lookupPropertyKnowledgeBatch(
  inputs: Array<{ key: string; propertyId?: string | null; propertyLabel?: string | null }>,
  db: SupabaseLike = supabase,
): Promise<Map<string, PropertyKnowledgeLookup>> {
  const result = new Map<string, PropertyKnowledgeLookup>();
  const ids = [...new Set(inputs.map((item) => text(item.propertyId)).filter(Boolean))] as string[];
  const byId = new Map<string, BookingOpsPropertyKnowledge>();

  if (ids.length > 0) {
    const { data, error } = await db
      .from('tg_property_knowledge')
      .select(PROPERTY_KNOWLEDGE_SELECT)
      .in('property_id', ids);
    if (error) {
      for (const item of inputs) result.set(item.key, { knowledge: null, match: 'error', error: error.message });
      return result;
    }
    for (const row of (data ?? []) as PropertyKnowledgeRow[]) {
      const knowledge = mapPropertyKnowledgeRow(row);
      byId.set(knowledge.propertyId, knowledge);
    }
  }

  const unresolved = inputs.filter((item) => !byId.has(text(item.propertyId) ?? ''));
  const labels = [...new Set(unresolved.map((item) => text(item.propertyLabel)).filter(Boolean))] as string[];
  const byLabel = new Map<string, BookingOpsPropertyKnowledge[]>();
  if (labels.length > 0) {
    const { data, error } = await db
      .from('tg_property_knowledge')
      .select(PROPERTY_KNOWLEDGE_SELECT)
      .in('object_name', labels);
    if (error) {
      for (const item of unresolved) result.set(item.key, { knowledge: null, match: 'error', error: error.message });
    } else {
      for (const row of (data ?? []) as PropertyKnowledgeRow[]) {
        const knowledge = mapPropertyKnowledgeRow(row);
        const label = knowledge.propertyLabel;
        if (!label) continue;
        byLabel.set(label, [...(byLabel.get(label) ?? []), knowledge]);
      }
    }
  }

  for (const item of inputs) {
    const idMatch = byId.get(text(item.propertyId) ?? '');
    if (idMatch) {
      result.set(item.key, { knowledge: idMatch, match: 'property_id' });
      continue;
    }
    if (result.has(item.key)) continue;
    const candidates = byLabel.get(text(item.propertyLabel) ?? '') ?? [];
    if (candidates.length === 1) {
      result.set(item.key, { knowledge: candidates[0], match: 'property_label' });
    } else if (candidates.length > 1) {
      result.set(item.key, { knowledge: null, match: 'ambiguous' });
    } else {
      result.set(item.key, { knowledge: null, match: 'none' });
    }
  }
  return result;
}

export async function listPropertyKnowledge(
  db: SupabaseLike = supabase,
): Promise<{ ok: true; records: BookingOpsPropertyKnowledge[] } | { ok: false; error: string }> {
  const { data, error } = await db
    .from('tg_property_knowledge')
    .select(PROPERTY_KNOWLEDGE_SELECT)
    .order('updated_at', { ascending: false })
    .limit(300);
  if (error) return { ok: false, error: error.message };
  return { ok: true, records: ((data ?? []) as PropertyKnowledgeRow[]).map(mapPropertyKnowledgeRow) };
}

export async function upsertPropertyKnowledge(
  input: PropertyKnowledgeInput,
  db: SupabaseLike = supabase,
): Promise<{ ok: true; record: BookingOpsPropertyKnowledge } | { ok: false; error: string }> {
  const propertyId = text(input.propertyId);
  if (!propertyId) return { ok: false, error: 'Укажите ID объекта.' };

  const row: Record<string, unknown> = {
    property_id: propertyId,
    updated_at: new Date().toISOString(),
  };
  const fields: Array<[keyof PropertyKnowledgeInput, string]> = [
    ['propertyLabel', 'object_name'],
    ['address', 'address'],
    ['entranceInstructions', 'entrance_instructions'],
    ['floorApartment', 'floor_apartment'],
    ['intercomCode', 'intercom_code'],
    ['keyPickupInstructions', 'key_pickup_instructions'],
    ['wifiName', 'wifi_name'],
    ['wifiPassword', 'wifi_password'],
    ['parkingInstructions', 'parking_instructions'],
    ['houseRules', 'house_rules'],
    ['quietHours', 'quiet_hours'],
    ['checkoutInstructions', 'checkout_instructions'],
    ['emergencyInstructions', 'emergency_instructions'],
    ['cleaningLinenNotes', 'cleaning_linen_notes'],
    ['publicGuestNotes', 'public_guest_notes'],
    ['privateOperatorNotes', 'private_operator_notes'],
  ];
  for (const [inputKey, column] of fields) {
    if (input[inputKey] !== undefined) row[column] = text(input[inputKey]);
  }

  const { data, error } = await db
    .from('tg_property_knowledge')
    .upsert(row, { onConflict: 'property_id', ignoreDuplicates: false })
    .select(PROPERTY_KNOWLEDGE_SELECT)
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Не удалось сохранить данные объекта.' };
  return { ok: true, record: mapPropertyKnowledgeRow(data) };
}
