import { supabase } from '@/lib/supabase';
import {
  buildSetupMirrorUpdates,
  normalizeSetupData,
  setupDataFromExisting,
  type PropertySetupData,
} from '@/lib/property-setup/setup-data';
import type { OpsProperty, PropertyMasterCard } from '@/lib/ops-foundation/types';
import type { TelegramPropertyObjectV1 } from './telegram-booking-object-memory';

type SupabaseLike = { from: (table: string) => any };

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

function textOrNull(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

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

function composeFullAddress(city: string | null, line: string | null): string | null {
  const addressLine = textOrNull(line);
  const cityName = textOrNull(city);
  if (!addressLine && !cityName) return null;
  if (!addressLine) return cityName;
  if (!cityName) return addressLine;
  if (addressLine.toLowerCase().includes(cityName.toLowerCase())) return addressLine;
  return `${cityName}, ${addressLine}`;
}

function composeDirections(setup: PropertySetupData, masterCard: PropertyMasterCard | null): string | null {
  return (
    textOrNull(setup.address.accessNote) ??
    textOrNull(setup.checkInOut.checkInInstructions) ??
    textOrNull(masterCard?.checkInInstructions) ??
  null
  );
}

function composeCheckInText(setup: PropertySetupData, masterCard: PropertyMasterCard | null): string | null {
  const parts: string[] = [];
  const checkInTime = textOrNull(setup.checkInOut.checkInTime);
  const checkInInstructions =
    textOrNull(setup.checkInOut.checkInInstructions) ?? textOrNull(masterCard?.checkInInstructions);
  if (checkInTime) parts.push(`Заезд с ${checkInTime}`);
  if (checkInInstructions) parts.push(checkInInstructions);
  return parts.length > 0 ? parts.join('. ') : null;
}

export function mapSetupSourcesToGuestTestProperty(input: {
  propertyId: string;
  property: OpsProperty;
  masterCard: PropertyMasterCard | null;
  setup: PropertySetupData;
}): TelegramPropertyObjectV1 {
  const mirror = buildSetupMirrorUpdates(input.setup);
  const city = mirror.property.city ?? input.property.city ?? null;
  const addressLine = mirror.property.address ?? input.property.address ?? null;
  const address = composeFullAddress(city, addressLine);

  const wifiName = mirror.masterCard.wifiName ?? input.masterCard?.wifiName ?? null;
  const wifiPassword = mirror.masterCard.wifiPassword ?? input.masterCard?.wifiPassword ?? null;
  const houseRules = mirror.masterCard.houseRules ?? input.masterCard?.houseRules ?? null;
  const checkInText = composeCheckInText(input.setup, input.masterCard);
  const checkoutTime = textOrNull(input.setup.checkInOut.checkOutTime);
  const objectName = mirror.property.title ?? input.property.title ?? null;

  return {
    object_id: input.propertyId,
    object_name: objectName,
    address,
    directions_text: composeDirections(input.setup, input.masterCard),
    parking_text: textOrNull(input.masterCard?.parkingInfo),
    trash_bins_location: null,
    waste_disposal_text: null,
    wifi_name: wifiName,
    wifi_password: wifiPassword,
    baby_crib_available: null,
    baby_crib_note: null,
    check_in_text: checkInText,
    checkout_time: checkoutTime,
    house_rules_text: houseRules,
    door_code_notes: null,
    early_checkin_policy: null,
    late_checkout_policy: null,
  };
}

export async function lookup_property_for_guest_test(
  propertyId: string,
  db: SupabaseLike = supabase as unknown as SupabaseLike,
): Promise<TelegramPropertyObjectV1 | null> {
  const id = propertyId.trim();
  if (!id) return null;

  const [propertyResult, masterCardResult, setupResult] = await Promise.all([
    db.from('properties').select('*').eq('id', id).maybeSingle(),
    db.from('property_master_cards').select('*').eq('property_id', id).maybeSingle(),
    db.from('property_setup_profiles').select('data').eq('property_id', id).maybeSingle(),
  ]);

  if (propertyResult.error) throw propertyResult.error;
  if (masterCardResult.error) throw masterCardResult.error;
  if (setupResult.error) throw setupResult.error;
  if (!propertyResult.data) return null;

  const property = mapProperty(propertyResult.data as PropertyRow);
  const masterCard = masterCardResult.data ? mapMasterCard(masterCardResult.data as MasterCardRow) : null;
  const setupRaw = (setupResult.data as { data?: unknown } | null)?.data ?? null;
  const setup = setupRaw
    ? normalizeSetupData(setupRaw)
    : setupDataFromExisting(property, masterCard);

  return mapSetupSourcesToGuestTestProperty({
    propertyId: id,
    property,
    masterCard,
    setup,
  });
}
