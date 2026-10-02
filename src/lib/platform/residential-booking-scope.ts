import { supabase } from '@/lib/supabase';
import { validIdentity } from './decision';
import type { IdentifiedScope } from './snapshot';

function text(value: unknown): string {
  return String(value ?? '').trim();
}

/**
 * Resolves RU residential decision identity only from the canonical booking row.
 * Request/query metadata is never trusted for account or property ownership.
 */
export async function resolveResidentialBookingIdentity(
  bookingId: string,
  expectedAccountId?: string,
): Promise<IdentifiedScope> {
  const id = text(bookingId);
  if (!id) throw new Error('booking_not_found');

  const { data, error } = await supabase
    .from('booking_ops_records')
    .select('id, account_id, property_id')
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error('booking_scope_unavailable');
  if (!data) throw new Error('booking_not_found');

  const row = data as { id?: unknown; account_id?: unknown; property_id?: unknown };
  const accountId = text(row.account_id);
  const propertyId = text(row.property_id);
  const canonicalBookingId = text(row.id);

  if (!accountId || !propertyId || canonicalBookingId !== id) {
    throw new Error('booking_scope_unavailable');
  }
  const identity = { kind: 'identified' as const, accountId, propertyId, bookingId: canonicalBookingId };
  if (!validIdentity(identity)) throw new Error('booking_scope_unavailable');
  if (expectedAccountId !== undefined && text(expectedAccountId) !== accountId) {
    throw new Error('booking_scope_mismatch');
  }
  return identity;
}
