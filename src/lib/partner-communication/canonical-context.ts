import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { isAuthenticatedPartnerPrincipal, type AuthenticatedPartnerPrincipal } from './auth';
import type { PartnerCommunicationContext } from './contract';

const RESOLVED_CANONICAL_CONTEXT = Symbol('resolved-partner-canonical-context');

type PropertyBindingRow = {
  account_id: string;
  partner_account_binding_id: string;
  external_property_id: string;
  property_id: string;
  status: 'active' | 'disabled';
};

type BookingBindingRow = {
  account_id: string;
  partner_account_binding_id: string;
  external_booking_id: string;
  booking_ops_record_id: string;
  property_id: string;
  status: 'active' | 'disabled';
};

type CanonicalBookingRow = {
  id: string;
  account_id: string | null;
  property_id: string | null;
};

export type PartnerCanonicalResolutionReason =
  | 'property_mapping_missing'
  | 'property_mapping_conflict'
  | 'booking_mapping_missing'
  | 'booking_mapping_conflict';

export type ResolvedPartnerCanonicalContext = Readonly<{
  [RESOLVED_CANONICAL_CONTEXT]: true;
  status: 'resolved';
  accountId: string;
  propertyId: string;
  bookingId: string;
}>;

export type PartnerCanonicalResolution = ResolvedPartnerCanonicalContext | Readonly<{
  [RESOLVED_CANONICAL_CONTEXT]: true;
  status: 'unresolved';
  accountId: string;
  reasonCode: PartnerCanonicalResolutionReason;
}>;

export interface PartnerCanonicalContextDatabase {
  findPropertyBindings(input: {
    accountId: string;
    partnerAccountBindingId: string;
    externalPropertyId: string;
  }): Promise<PropertyBindingRow[]>;
  findBookingBindings(input: {
    accountId: string;
    partnerAccountBindingId: string;
    externalBookingId: string;
  }): Promise<BookingBindingRow[]>;
  findCanonicalBooking(input: { accountId: string; bookingId: string }): Promise<CanonicalBookingRow | null>;
}

function unresolved(accountId: string, reasonCode: PartnerCanonicalResolutionReason): PartnerCanonicalResolution {
  return Object.freeze({
    [RESOLVED_CANONICAL_CONTEXT]: true as const,
    status: 'unresolved' as const,
    accountId,
    reasonCode,
  });
}

export function isPartnerCanonicalResolution(value: unknown): value is PartnerCanonicalResolution {
  return Boolean(value && typeof value === 'object'
    && (value as { [RESOLVED_CANONICAL_CONTEXT]?: unknown })[RESOLVED_CANONICAL_CONTEXT] === true);
}

export function createPartnerCanonicalContextResolver(database: PartnerCanonicalContextDatabase) {
  return async function resolve(
    principal: AuthenticatedPartnerPrincipal,
    context: PartnerCommunicationContext,
  ): Promise<PartnerCanonicalResolution> {
    if (
      !isAuthenticatedPartnerPrincipal(principal)
      || principal.partnerId !== context.identity.partnerId
      || principal.externalPartnerAccountId !== context.identity.accountId
    ) return unresolved(principal.accountId, 'property_mapping_conflict');

    const scope = {
      accountId: principal.accountId,
      partnerAccountBindingId: principal.partnerAccountBindingId,
    };
    const propertyMatches = await database.findPropertyBindings({
      ...scope,
      externalPropertyId: context.identity.propertyId,
    });
    if (propertyMatches.length === 0) return unresolved(scope.accountId, 'property_mapping_missing');
    if (propertyMatches.length !== 1 || propertyMatches[0].status !== 'active') {
      return unresolved(scope.accountId, 'property_mapping_conflict');
    }
    const property = propertyMatches[0];
    if (
      property.account_id !== scope.accountId
      || property.partner_account_binding_id !== scope.partnerAccountBindingId
      || property.external_property_id !== context.identity.propertyId
    ) return unresolved(scope.accountId, 'property_mapping_conflict');

    const bookingMatches = await database.findBookingBindings({
      ...scope,
      externalBookingId: context.identity.bookingId,
    });
    if (bookingMatches.length === 0) return unresolved(scope.accountId, 'booking_mapping_missing');
    if (bookingMatches.length !== 1 || bookingMatches[0].status !== 'active') {
      return unresolved(scope.accountId, 'booking_mapping_conflict');
    }
    const bookingBinding = bookingMatches[0];
    if (
      bookingBinding.account_id !== scope.accountId
      || bookingBinding.partner_account_binding_id !== scope.partnerAccountBindingId
      || bookingBinding.external_booking_id !== context.identity.bookingId
      || bookingBinding.property_id !== property.property_id
    ) return unresolved(scope.accountId, 'booking_mapping_conflict');

    const booking = await database.findCanonicalBooking({
      accountId: scope.accountId,
      bookingId: bookingBinding.booking_ops_record_id,
    });
    if (
      !booking
      || booking.id !== bookingBinding.booking_ops_record_id
      || booking.account_id !== scope.accountId
      || booking.property_id !== property.property_id
    ) return unresolved(scope.accountId, 'booking_mapping_conflict');

    return Object.freeze({
      [RESOLVED_CANONICAL_CONTEXT]: true as const,
      status: 'resolved' as const,
      accountId: scope.accountId,
      propertyId: property.property_id,
      bookingId: booking.id,
    });
  };
}

function persistenceFailure(): never {
  throw new Error('partner_canonical_context_lookup_failed');
}

export function createSupabasePartnerCanonicalContextDatabase(
  client: SupabaseClient,
): PartnerCanonicalContextDatabase {
  return {
    async findPropertyBindings(input) {
      const { data, error } = await client.from('partner_property_bindings').select('*')
        .eq('account_id', input.accountId)
        .eq('partner_account_binding_id', input.partnerAccountBindingId)
        .eq('external_property_id', input.externalPropertyId).limit(2);
      if (error) persistenceFailure();
      return (data ?? []) as PropertyBindingRow[];
    },
    async findBookingBindings(input) {
      const { data, error } = await client.from('partner_booking_bindings').select('*')
        .eq('account_id', input.accountId)
        .eq('partner_account_binding_id', input.partnerAccountBindingId)
        .eq('external_booking_id', input.externalBookingId).limit(2);
      if (error) persistenceFailure();
      return (data ?? []) as BookingBindingRow[];
    },
    async findCanonicalBooking(input) {
      const { data, error } = await client.from('booking_ops_records').select('id,account_id,property_id')
        .eq('account_id', input.accountId).eq('id', input.bookingId).maybeSingle();
      if (error) persistenceFailure();
      return data as CanonicalBookingRow | null;
    },
  };
}

export const resolvePartnerCanonicalContext = createPartnerCanonicalContextResolver(
  createSupabasePartnerCanonicalContextDatabase(supabase),
);
