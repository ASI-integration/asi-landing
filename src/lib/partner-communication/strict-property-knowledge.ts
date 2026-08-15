import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export type StrictPartnerPropertyKnowledge = Readonly<{
  propertyId: string;
  wifiName: string | null;
  wifiPassword: string | null;
  wifiNotes: string | null;
  checkinInstructions: string | null;
  accessNotes: string | null;
  doorCodeNotes: string | null;
  checkinTime: string | null;
  checkoutNotes: string | null;
  checkoutTime: string | null;
  parkingRules: string | null;
  parkingPaidOrFree: string | null;
  parkingLocationNotes: string | null;
  houseRules: string | null;
  quietHours: string | null;
}>;

export type StrictPartnerPropertyKnowledgeResult = Readonly<
  | { status: 'found'; source: 'tg_property_knowledge'; knowledge: StrictPartnerPropertyKnowledge }
  | { status: 'missing'; source: 'tg_property_knowledge'; knowledge: null }
  | { status: 'lookup_failed'; source: 'tg_property_knowledge'; knowledge: null }
  | { status: 'not_loaded'; source: 'none'; knowledge: null }
>;

type PropertyRow = { id: string; account_id: string; status: string };
type KnowledgeRow = Record<string, unknown> & { property_id: string; active: boolean | null };

export interface StrictPartnerPropertyKnowledgeDatabase {
  findActiveProperty(input: { accountId: string; propertyId: string }): Promise<PropertyRow | null>;
  findActiveKnowledge(propertyId: string): Promise<KnowledgeRow | null>;
}

const KNOWLEDGE_COLUMNS = [
  'property_id',
  'active',
  'wifi_name',
  'wifi_password',
  'wifi_notes',
  'checkin_instructions',
  'access_notes',
  'door_code_notes',
  'check_in_time',
  'checkout_notes',
  'check_out_time',
  'parking_rules',
  'parking_paid_or_free',
  'parking_location_notes',
  'house_rules',
  'quiet_hours',
].join(',');

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function mapKnowledge(row: KnowledgeRow): StrictPartnerPropertyKnowledge {
  return Object.freeze({
    propertyId: row.property_id,
    wifiName: text(row.wifi_name),
    wifiPassword: text(row.wifi_password),
    wifiNotes: text(row.wifi_notes),
    checkinInstructions: text(row.checkin_instructions),
    accessNotes: text(row.access_notes),
    doorCodeNotes: text(row.door_code_notes),
    checkinTime: text(row.check_in_time),
    checkoutNotes: text(row.checkout_notes),
    checkoutTime: text(row.check_out_time),
    parkingRules: text(row.parking_rules),
    parkingPaidOrFree: text(row.parking_paid_or_free),
    parkingLocationNotes: text(row.parking_location_notes),
    houseRules: text(row.house_rules),
    quietHours: text(row.quiet_hours),
  });
}

export function createStrictPartnerPropertyKnowledgeLoader(
  database: StrictPartnerPropertyKnowledgeDatabase,
) {
  return async function getStrictPartnerPropertyKnowledge(input: {
    accountId: string;
    propertyId: string;
  }): Promise<StrictPartnerPropertyKnowledgeResult> {
    try {
      const property = await database.findActiveProperty(input);
      if (
        !property
        || property.id !== input.propertyId
        || property.account_id !== input.accountId
        || property.status !== 'active'
      ) return Object.freeze({ status: 'missing', source: 'tg_property_knowledge', knowledge: null });

      const row = await database.findActiveKnowledge(input.propertyId);
      if (!row || row.property_id !== input.propertyId || row.active === false) {
        return Object.freeze({ status: 'missing', source: 'tg_property_knowledge', knowledge: null });
      }
      return Object.freeze({
        status: 'found',
        source: 'tg_property_knowledge',
        knowledge: mapKnowledge(row),
      });
    } catch {
      return Object.freeze({ status: 'lookup_failed', source: 'tg_property_knowledge', knowledge: null });
    }
  };
}

export function createSupabaseStrictPartnerPropertyKnowledgeDatabase(
  client: SupabaseClient,
): StrictPartnerPropertyKnowledgeDatabase {
  return {
    async findActiveProperty(input) {
      const { data, error } = await client.from('properties').select('id,account_id,status')
        .eq('account_id', input.accountId).eq('id', input.propertyId).eq('status', 'active').maybeSingle();
      if (error) throw new Error('strict_partner_property_lookup_failed');
      return data as PropertyRow | null;
    },
    async findActiveKnowledge(propertyId) {
      const { data, error } = await client.from('tg_property_knowledge').select(KNOWLEDGE_COLUMNS)
        .eq('property_id', propertyId).eq('active', true).maybeSingle();
      if (error) throw new Error('strict_partner_knowledge_lookup_failed');
      return data as KnowledgeRow | null;
    },
  };
}

export const getStrictPartnerPropertyKnowledge = createStrictPartnerPropertyKnowledgeLoader(
  createSupabaseStrictPartnerPropertyKnowledgeDatabase(supabase),
);

export const PARTNER_STRICT_KNOWLEDGE_COLUMNS = Object.freeze(KNOWLEDGE_COLUMNS.split(','));
