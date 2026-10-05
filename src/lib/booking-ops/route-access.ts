import { supabase } from '@/lib/supabase';
import { resolveReservationAccess } from '@/lib/reservations/access';
import { resolveResidentialBookingIdentity } from '@/lib/platform/residential-booking-scope';

type Session = Parameters<typeof resolveReservationAccess>[0];

export type BookingOpsRouteAccess = {
  accountId: string;
  actorId: string;
  bookingId: string;
  propertyId: string;
};

function text(value: unknown): string {
  return String(value ?? '').trim();
}

export async function resolveBookingOpsAccount(session: Session): Promise<{
  accountId: string;
  actorId: string;
}> {
  const access = await resolveReservationAccess(session);
  const accountId = text(access.accountId);
  if (!accountId || accountId === 'legacy') throw new Error('account_workspace_unavailable');
  return { accountId, actorId: access.actorId };
}

export async function requireBookingOpsRouteAccess(
  session: Session,
  bookingId: string,
): Promise<BookingOpsRouteAccess> {
  const access = await resolveBookingOpsAccount(session);
  const identity = await resolveResidentialBookingIdentity(bookingId, access.accountId);
  if (!identity.bookingId || !identity.propertyId) throw new Error('booking_scope_unavailable');
  return {
    accountId: access.accountId,
    actorId: access.actorId,
    bookingId: identity.bookingId,
    propertyId: identity.propertyId,
  };
}

export async function requireBookingOpsPropertyAccountScope(
  accountId: string,
  propertyId: string,
): Promise<{ accountId: string; propertyId: string }> {
  const account = text(accountId);
  const id = text(propertyId);
  if (!account || account === 'legacy') throw new Error('account_workspace_unavailable');
  if (!id) throw new Error('property_id_required');
  const result = await supabase
    .from('properties')
    .select('id,account_id')
    .eq('id', id)
    .eq('account_id', account)
    .maybeSingle();
  if (result.error) throw new Error('property_scope_unavailable');
  if (!result.data) throw new Error('property_scope_mismatch');
  return { accountId: account, propertyId: id };
}

export async function requireBookingOpsPropertyAccess(
  session: Session,
  propertyId: string,
): Promise<{ accountId: string; actorId: string; propertyId: string }> {
  const access = await resolveBookingOpsAccount(session);
  const property = await requireBookingOpsPropertyAccountScope(access.accountId, propertyId);
  return { ...access, propertyId: property.propertyId };
}
