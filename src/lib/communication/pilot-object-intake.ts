import { supabase } from '@/lib/supabase';
import type {
  ObjectKnowledgeCategory,
  ObjectKnowledgeConfidence,
  ObjectKnowledgeSensitivity,
  ObjectKnowledgeSourceType,
  ObjectKnowledgeVisibility,
} from './object-knowledge';

type SupabaseLike = { from: (table: string) => any };

export type PilotObjectIntakeInput = {
  objectId?: string;
  city: string;
  objectName: string;
  addressOrArea: string;
  wifiName: string;
  wifiPassword: string;
  accessInstructions: string;
  trashBinsLocation: string;
  parkingText: string;
  checkoutTime: string;
  houseRules: string;
  additionalFeatures: string;
  ownerContact: string;
};

export type PilotObjectKnowledgeRow = {
  object_id: string;
  property_id: string;
  category: ObjectKnowledgeCategory;
  key: string;
  value_text: string | null;
  value_json: Record<string, unknown> | null;
  visibility: ObjectKnowledgeVisibility;
  sensitivity: ObjectKnowledgeSensitivity;
  source_type: ObjectKnowledgeSourceType;
  confidence: ObjectKnowledgeConfidence;
  updated_by: string;
  last_verified_at: string;
  updated_at: string;
};

export type PilotObjectSummary = {
  objectId: string;
  city: string;
  objectName: string;
  addressOrArea: string;
  wifiName: string;
  accessInstructions: string;
  trashBinsLocation: string;
  parkingText: string;
  checkoutTime: string;
  houseRules: string;
  additionalFeatures: string;
  ownerContact: string;
};

const FIELD_TO_KEY: Record<keyof Omit<PilotObjectSummary, 'objectId'>, string> = {
  city: 'city',
  objectName: 'object_name',
  addressOrArea: 'address',
  wifiName: 'wifi_name',
  accessInstructions: 'check_in_text',
  trashBinsLocation: 'trash_bins_location',
  parkingText: 'parking_text',
  checkoutTime: 'checkout_time',
  houseRules: 'house_rules_text',
  additionalFeatures: 'pilot_notes',
  ownerContact: 'owner_contact',
};

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function slugPart(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/giu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42);
  return normalized || 'object';
}

export function createPilotObjectId(input: Pick<PilotObjectIntakeInput, 'city' | 'objectName'>): string {
  return `pilot_${slugPart(input.city)}_${slugPart(input.objectName)}_${Date.now().toString(36)}`;
}

export function normalizePilotObjectInput(input: Partial<PilotObjectIntakeInput>): PilotObjectIntakeInput {
  const normalized = {
    objectId: clean(input.objectId),
    city: clean(input.city),
    objectName: clean(input.objectName),
    addressOrArea: clean(input.addressOrArea),
    wifiName: clean(input.wifiName),
    wifiPassword: clean(input.wifiPassword),
    accessInstructions: clean(input.accessInstructions),
    trashBinsLocation: clean(input.trashBinsLocation),
    parkingText: clean(input.parkingText),
    checkoutTime: clean(input.checkoutTime),
    houseRules: clean(input.houseRules),
    additionalFeatures: clean(input.additionalFeatures),
    ownerContact: clean(input.ownerContact),
  };
  return {
    ...normalized,
    objectId: normalized.objectId || createPilotObjectId(normalized),
  };
}

function row(params: {
  objectId: string;
  category: ObjectKnowledgeCategory;
  key: string;
  valueText: string;
  visibility?: ObjectKnowledgeVisibility;
  sensitivity?: ObjectKnowledgeSensitivity;
  now: string;
}): PilotObjectKnowledgeRow | null {
  const valueText = clean(params.valueText);
  if (!valueText) return null;
  return {
    object_id: params.objectId,
    property_id: params.objectId,
    category: params.category,
    key: params.key,
    value_text: valueText,
    value_json: null,
    visibility: params.visibility ?? 'guest_public',
    sensitivity: params.sensitivity ?? 'normal',
    source_type: 'owner',
    confidence: 'high',
    updated_by: 'early_access_object_form',
    last_verified_at: params.now,
    updated_at: params.now,
  };
}

export function buildPilotObjectKnowledgeRows(input: PilotObjectIntakeInput, now = new Date()): PilotObjectKnowledgeRow[] {
  const objectId = input.objectId || createPilotObjectId(input);
  const timestamp = now.toISOString();
  return [
    row({ objectId, category: 'listing', key: 'city', valueText: input.city, now: timestamp }),
    row({ objectId, category: 'listing', key: 'object_name', valueText: input.objectName, now: timestamp }),
    row({ objectId, category: 'directions', key: 'address', valueText: input.addressOrArea, now: timestamp }),
    row({ objectId, category: 'wifi', key: 'wifi_name', valueText: input.wifiName, visibility: 'guest_after_booking_verified', now: timestamp }),
    row({
      objectId,
      category: 'wifi',
      key: 'wifi_password',
      valueText: input.wifiPassword,
      visibility: 'guest_after_booking_verified',
      sensitivity: 'password',
      now: timestamp,
    }),
    row({ objectId, category: 'access', key: 'check_in_text', valueText: input.accessInstructions, visibility: 'guest_after_booking_verified', now: timestamp }),
    row({ objectId, category: 'directions', key: 'directions_text', valueText: input.accessInstructions, visibility: 'guest_after_booking_verified', now: timestamp }),
    row({ objectId, category: 'waste', key: 'trash_bins_location', valueText: input.trashBinsLocation, now: timestamp }),
    row({ objectId, category: 'parking', key: 'parking_text', valueText: input.parkingText, now: timestamp }),
    row({ objectId, category: 'checkout', key: 'checkout_time', valueText: input.checkoutTime, now: timestamp }),
    row({ objectId, category: 'house_rules', key: 'house_rules_text', valueText: input.houseRules, now: timestamp }),
    row({ objectId, category: 'operations', key: 'pilot_notes', valueText: input.additionalFeatures, visibility: 'operator_only', now: timestamp }),
    row({
      objectId,
      category: 'operations',
      key: 'owner_contact',
      valueText: input.ownerContact,
      visibility: 'operator_only',
      sensitivity: 'personal_data',
      now: timestamp,
    }),
  ].filter((item): item is PilotObjectKnowledgeRow => Boolean(item));
}

export function summarizePilotObjectFromRows(objectId: string, rows: Array<{ key?: string; value_text?: string | null }>): PilotObjectSummary {
  const keyed = new Map(rows.map((item) => [String(item.key ?? ''), clean(item.value_text)]));
  const value = (field: keyof Omit<PilotObjectSummary, 'objectId'>) => keyed.get(FIELD_TO_KEY[field]) ?? '';
  return {
    objectId,
    city: value('city'),
    objectName: value('objectName'),
    addressOrArea: value('addressOrArea'),
    wifiName: value('wifiName'),
    accessInstructions: value('accessInstructions'),
    trashBinsLocation: value('trashBinsLocation'),
    parkingText: value('parkingText'),
    checkoutTime: value('checkoutTime'),
    houseRules: value('houseRules'),
    additionalFeatures: value('additionalFeatures'),
    ownerContact: value('ownerContact'),
  };
}

export async function savePilotObjectIntake(input: PilotObjectIntakeInput, db: SupabaseLike = supabase as unknown as SupabaseLike): Promise<PilotObjectSummary> {
  const rows = buildPilotObjectKnowledgeRows(input);
  if (rows.length === 0) throw new Error('pilot_object_empty');

  const { data, error } = await db
    .from('object_knowledge_entries')
    .upsert(rows, { onConflict: 'object_id,key' })
    .select('object_id,key,value_text');

  if (error) throw new Error(`pilot_object_save_failed:${error.message ?? 'unknown'}`);
  return summarizePilotObjectFromRows(input.objectId || rows[0].object_id, Array.isArray(data) ? data : rows);
}

export async function getPilotObjectSummary(objectId: string, db: SupabaseLike = supabase as unknown as SupabaseLike): Promise<PilotObjectSummary | null> {
  const id = clean(objectId);
  if (!id) return null;
  const { data, error } = await db
    .from('object_knowledge_entries')
    .select('key,value_text')
    .eq('object_id', id)
    .order('updated_at', { ascending: false });
  if (error) throw new Error(`pilot_object_get_failed:${error.message ?? 'unknown'}`);
  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) return null;
  return summarizePilotObjectFromRows(id, rows);
}
