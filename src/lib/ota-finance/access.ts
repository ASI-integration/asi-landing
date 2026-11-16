import 'server-only';

import { getSession, isSessionSecretConfigured } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

/**
 * Source-only gate for a future direct-PostgreSQL OTA financial adapter.
 * The private schema is deliberately NOT exposed by the Supabase Data API.
 * Every backend operation must call this gate before a private read/write;
 * no HTTP endpoint or financial database adapter is enabled here.
 */
export type OtaFinanceAction = 'read' | 'import' | 'review' | 'fee_rule';
export type OtaFinanceScopeRequest = {
  accountId: string;
  propertyId: string;
  action: OtaFinanceAction;
  bookingId?: string;
};

export class OtaFinanceAccessError extends Error {
  constructor(public readonly code: string, public readonly status: 400 | 401 | 403 | 503) {
    super(code);
    this.name = 'OtaFinanceAccessError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function reject(code: string, status: 400 | 401 | 403 | 503): never {
  throw new OtaFinanceAccessError(code, status);
}

export async function requireOtaFinanceScope(
  request: OtaFinanceScopeRequest,
): Promise<{ accountId: string; propertyId: string; actorUserId: string; role: 'owner' | 'manager'; bookingId?: string }> {
  if (!isSessionSecretConfigured()) reject('FINANCE_AUTH_UNAVAILABLE', 503);
  const session = await getSession();
  const actorUserId = session.userId;
  if (!actorUserId || !UUID.test(actorUserId)) reject('FINANCE_LOGIN_REQUIRED', 401);

  // The client may propose an account/property, but cannot grant itself scope.
  // Never resolve "first account", use a legacy pseudo-account, or coerce an
  // arbitrary booking property string into a canonical UUID.
  if (!request || typeof request !== 'object' || !UUID.test(request.accountId) || !UUID.test(request.propertyId))
    reject('FINANCE_INVALID_CANONICAL_SCOPE', 400);
  if (!['read', 'import', 'review', 'fee_rule'].includes(request.action))
    reject('FINANCE_INVALID_ACTION', 400);
  if (request.bookingId !== undefined &&
      (typeof request.bookingId !== 'string' || request.bookingId.length < 1 || request.bookingId.length > 200))
    reject('FINANCE_INVALID_BOOKING_ID', 400);

  const membership = await supabase
    .from('account_members')
    .select('role')
    .eq('account_id', request.accountId)
    .eq('user_id', actorUserId)
    .maybeSingle();
  if (membership.error) reject('FINANCE_MEMBERSHIP_LOOKUP_UNAVAILABLE', 503);
  if (membership.data?.role !== 'owner' && membership.data?.role !== 'manager')
    reject('FINANCE_ACCOUNT_FORBIDDEN', 403);
  // Until a finance-specific delegation policy is approved, only the
  // owner can append contracts, statement imports or operator reviews.
  if (request.action !== 'read' && membership.data.role !== 'owner')
    reject('FINANCE_WRITE_REQUIRES_OWNER', 403);

  const property = await supabase
    .from('properties')
    .select('id,account_id')
    .eq('id', request.propertyId)
    .eq('account_id', request.accountId)
    .maybeSingle();
  if (property.error) reject('FINANCE_PROPERTY_LOOKUP_UNAVAILABLE', 503);
  if (!property.data || property.data.id !== request.propertyId || property.data.account_id !== request.accountId)
    reject('FINANCE_PROPERTY_FORBIDDEN', 403);

  if (request.bookingId !== undefined) {
    // Legacy booking_ops_records uses text account/property identifiers. Only
    // exact canonical UUID text values are accepted until an explicit mapping
    // table and reconciliation procedure are approved.
    const booking = await supabase
      .from('booking_ops_records')
      .select('id,account_id,property_id,booking_id')
      .eq('account_id', request.accountId)
      .eq('property_id', request.propertyId)
      .eq('booking_id', request.bookingId)
      .limit(2);
    if (booking.error) reject('FINANCE_BOOKING_LOOKUP_UNAVAILABLE', 503);
    if (booking.data?.length !== 1 ||
        booking.data[0].account_id !== request.accountId ||
        booking.data[0].property_id !== request.propertyId ||
        booking.data[0].booking_id !== request.bookingId)
      reject('FINANCE_BOOKING_SCOPE_AMBIGUOUS_OR_MISSING', 403);
  }

  // Minimum audit trail. The later persistent audit adapter must record
  // denial decisions as well. Never log guest data, key material or CSV rows.
  console.info('OTA_FINANCE_SCOPE_AUTHORIZED', {
    action: request.action, actorUserId, accountId: request.accountId,
    propertyId: request.propertyId, hasBooking: request.bookingId !== undefined,
  });

  return {
    accountId: request.accountId,
    propertyId: request.propertyId,
    actorUserId,
    role: membership.data.role,
    ...(request.bookingId !== undefined ? { bookingId: request.bookingId } : {}),
  };
}
