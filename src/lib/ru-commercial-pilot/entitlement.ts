import { createHash } from 'node:crypto';
import { supabase } from '@/lib/supabase';

export type PilotEntitlementClaim =
  | { ok: true; reused: boolean }
  | { ok: false; reason: 'standard_pilot_already_used' };

function normalizePart(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function derivePropertyPilotKey(input: {
  addressLine?: string | null;
  city?: string | null;
  country?: string | null;
}): string | null {
  const address = normalizePart(input.addressLine);
  if (!address) return null;
  const canonical = [normalizePart(input.country), normalizePart(input.city), address].join('|');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export async function claimStandardPilotEntitlement(input: {
  accountId: string;
  propertyId: string;
  startedAt: Date;
  allowOperatorOverride?: boolean;
}): Promise<PilotEntitlementClaim> {
  const property = await supabase
    .from('properties')
    .select('id,account_id,address_line,city,country')
    .eq('id', input.propertyId)
    .eq('account_id', input.accountId)
    .maybeSingle();
  if (property.error || !property.data) throw new Error(property.error?.message ?? 'property_not_found');

  const propertyKey = derivePropertyPilotKey({
    addressLine: property.data.address_line,
    city: property.data.city,
    country: property.data.country,
  });
  if (!propertyKey) throw new Error('pilot_property_identity_missing');

  const row = {
    property_key: propertyKey,
    first_account_id: input.accountId,
    first_property_id: input.propertyId,
    first_pilot_started_at: input.startedAt.toISOString(),
    last_account_id: input.accountId,
    last_property_id: input.propertyId,
    last_pilot_started_at: input.startedAt.toISOString(),
  };
  const inserted = await supabase.from('ru_commercial_pilot_entitlements').insert(row);
  if (!inserted.error) return { ok: true, reused: false };
  if (inserted.error.code !== '23505') throw new Error(inserted.error.message);

  const existing = await supabase.from('ru_commercial_pilot_entitlements')
    .select('first_account_id,first_property_id,grant_count,operator_override_count')
    .eq('property_key', propertyKey).single();
  if (existing.error || !existing.data) throw new Error(existing.error?.message ?? 'pilot_entitlement_lookup_failed');

  // Retries/concurrent starts for the same lifecycle are idempotent, not a second grant.
  if (existing.data.first_account_id === input.accountId && existing.data.first_property_id === input.propertyId) {
    return { ok: true, reused: true };
  }
  if (!input.allowOperatorOverride) return { ok: false, reason: 'standard_pilot_already_used' };
  const updated = await supabase.from('ru_commercial_pilot_entitlements').update({
    last_account_id: input.accountId,
    last_property_id: input.propertyId,
    last_pilot_started_at: input.startedAt.toISOString(),
    grant_count: Number(existing.data.grant_count) + 1,
    operator_override_count: Number(existing.data.operator_override_count) + 1,
    updated_at: new Date().toISOString(),
  }).eq('property_key', propertyKey);
  if (updated.error) throw new Error(updated.error.message);
  return { ok: true, reused: false };
}
