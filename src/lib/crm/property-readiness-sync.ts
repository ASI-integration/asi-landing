import { supabase } from '@/lib/supabase';
import type { OpsProperty, PropertyMasterCard, PropertyMedia } from '@/lib/ops-foundation/types';
import {
  buildCrmPropertyAutomationSummary,
  deriveCrmAutomationSuggestion,
} from './automation-loop';
import { syncGuestTestOnPropertyReady } from './guest-test-flow';
import { updateCrmContact, recordCrmCommunicationEvent } from './repository';
import type { CrmContactRow } from './types';
import {
  computeObjectGuestReadiness,
  guestReadinessMissingFieldTokens,
  type ObjectGuestReadiness,
} from '@/lib/property-setup/object-guest-readiness';
import { normalizeSetupData, setupDataFromExisting } from '@/lib/property-setup/setup-data';

const CONTACT_SELECT =
  'id, name, role, source, contact, telegram_user_id, telegram_username, telegram_chat_id, status, property_id, property_count, notes, next_action, next_action_due_at, last_message, last_activity_at, lead_id, awaiting_reply, created_at, updated_at';

type PropertyRow = {
  id: string;
  account_id: string;
  name: string;
  address_line: string | null;
  city: string | null;
  timezone: string | null;
  status: OpsProperty['status'];
  created_at: string;
  updated_at: string;
};

type MasterCardRow = {
  id: string;
  property_id: string;
  public_title: string | null;
  short_description: string | null;
  full_description: string | null;
  amenities: unknown;
  house_rules: string | null;
  check_in_instructions: string | null;
  check_out_instructions: string | null;
  wifi_name: string | null;
  wifi_password: string | null;
  parking_info: string | null;
  deposit_info: string | null;
  extra_fees_info: string | null;
  cancellation_info: string | null;
  guest_contacts_info: string | null;
  internal_notes: string | null;
  content_version: number;
  publication_status: PropertyMasterCard['publicationStatus'];
  created_at: string;
  updated_at: string;
};

type MediaRow = {
  id: string;
  property_id: string;
  url: string | null;
  storage_path: string | null;
  title: string | null;
  description: string | null;
  sort_order: number;
  is_cover: boolean;
  status: PropertyMedia['status'];
  created_at: string;
  updated_at: string;
};

function mapProperty(row: PropertyRow): OpsProperty {
  return {
    id: row.id,
    accountId: row.account_id,
    title: row.name,
    address: row.address_line,
    city: row.city,
    timezone: row.timezone,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMasterCard(row: MasterCardRow): PropertyMasterCard {
  return {
    id: row.id,
    propertyId: row.property_id,
    publicTitle: row.public_title,
    shortDescription: row.short_description,
    fullDescription: row.full_description,
    amenities: Array.isArray(row.amenities)
      ? row.amenities.filter((item): item is string => typeof item === 'string')
      : [],
    houseRules: row.house_rules,
    checkInInstructions: row.check_in_instructions,
    checkOutInstructions: row.check_out_instructions,
    wifiName: row.wifi_name,
    wifiPassword: row.wifi_password,
    parkingInfo: row.parking_info,
    depositInfo: row.deposit_info,
    extraFeesInfo: row.extra_fees_info,
    cancellationInfo: row.cancellation_info,
    guestContactsInfo: row.guest_contacts_info,
    internalNotes: row.internal_notes,
    contentVersion: row.content_version,
    publicationStatus: row.publication_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMedia(row: MediaRow): PropertyMedia {
  return {
    id: row.id,
    propertyId: row.property_id,
    url: row.url,
    storagePath: row.storage_path,
    title: row.title,
    description: row.description,
    sortOrder: row.sort_order,
    isCover: row.is_cover,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadObjectGuestReadiness(propertyId: string): Promise<{
  found: boolean;
  readiness: ObjectGuestReadiness | null;
}> {
  const id = propertyId.trim();
  const [propertyResult, masterCardResult, mediaResult, setupResult] = await Promise.all([
    supabase.from('properties').select('*').eq('id', id).maybeSingle(),
    supabase.from('property_master_cards').select('*').eq('property_id', id).maybeSingle(),
    supabase.from('property_media').select('*').eq('property_id', id).neq('status', 'deleted'),
    supabase.from('property_setup_profiles').select('data').eq('property_id', id).maybeSingle(),
  ]);

  if (propertyResult.error) throw propertyResult.error;
  if (masterCardResult.error) throw masterCardResult.error;
  if (mediaResult.error) throw mediaResult.error;
  if (setupResult.error) throw setupResult.error;

  if (!propertyResult.data) {
    return { found: false, readiness: null };
  }

  const property = mapProperty(propertyResult.data as PropertyRow);
  const masterCard = masterCardResult.data ? mapMasterCard(masterCardResult.data as MasterCardRow) : null;
  const media = ((mediaResult.data ?? []) as MediaRow[]).map(mapMedia);
  const setupRaw = (setupResult.data as { data?: unknown } | null)?.data ?? null;
  const setup = setupRaw
    ? normalizeSetupData(setupRaw)
    : setupDataFromExisting(property, masterCard);

  return {
    found: true,
    readiness: computeObjectGuestReadiness({
      propertyId: id,
      property,
      masterCard,
      setup,
      media,
    }),
  };
}

async function listOwnerContactsForProperty(propertyId: string): Promise<CrmContactRow[]> {
  const { data, error } = await supabase
    .from('crm_contacts')
    .select(CONTACT_SELECT)
    .eq('property_id', propertyId.trim())
    .in('role', ['owner', 'manager']);

  if (error) throw error;
  return (data ?? []) as CrmContactRow[];
}

export async function syncCrmAfterPropertySetupSave(propertyId: string): Promise<void> {
  const id = propertyId.trim();
  if (!id) return;

  try {
    const loaded = await loadObjectGuestReadiness(id);
    if (!loaded.found || !loaded.readiness) return;

    const contacts = await listOwnerContactsForProperty(id);
    if (contacts.length === 0) return;

    const propertyResult = await supabase.from('properties').select('*').eq('id', id).maybeSingle();
    if (!propertyResult.data) return;

    const property = mapProperty(propertyResult.data as PropertyRow);
    const [masterCardResult, mediaResult, setupResult] = await Promise.all([
      supabase.from('property_master_cards').select('*').eq('property_id', id).maybeSingle(),
      supabase.from('property_media').select('*').eq('property_id', id).neq('status', 'deleted'),
      supabase.from('property_setup_profiles').select('data').eq('property_id', id).maybeSingle(),
    ]);

    const masterCard = masterCardResult.data ? mapMasterCard(masterCardResult.data as MasterCardRow) : null;
    const media = ((mediaResult.data ?? []) as MediaRow[]).map(mapMedia);
    const setupRaw = (setupResult.data as { data?: unknown } | null)?.data ?? null;

    const summary = buildCrmPropertyAutomationSummary({
      property,
      masterCard,
      setup: (setupRaw ?? null) as Record<string, unknown> | null,
      media,
    });

    for (const contact of contacts) {
      const suggestion = deriveCrmAutomationSuggestion({
        role: contact.role as 'owner' | 'manager',
        status: contact.status as import('./types').CrmStatus,
        source: contact.source,
        contact: contact.contact,
        telegramDisplay: contact.telegram_username ? `@${contact.telegram_username}` : null,
        propertyId: id,
        explicitNextAction: contact.next_action,
        propertySummary: summary,
      });

      await updateCrmContact(contact.id, {
        status: suggestion.effectiveStatus,
        nextAction: suggestion.suggestedNextAction,
        awaitingReply: false,
      });

      if (!loaded.readiness.isReady) {
        await recordCrmCommunicationEvent({
          contactId: contact.id,
          eventType: 'missing_data',
          propertyId: id,
          metadata: {
            source: 'property_setup_save',
            missing_fields: guestReadinessMissingFieldTokens(loaded.readiness.items),
            next_setup_step: loaded.readiness.nextItem?.setupStep ?? null,
            next_setup_href: loaded.readiness.nextItem?.actionHref ?? null,
          },
        });
      }
    }

    if (loaded.readiness.isReady) {
      await syncGuestTestOnPropertyReady(id);
    }
  } catch (error) {
    console.error('[crm] property setup readiness sync failed', {
      error: error instanceof Error ? error.message : String(error),
      propertyId: id,
    });
  }
}
