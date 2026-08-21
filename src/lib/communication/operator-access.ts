import { NextResponse } from 'next/server';
import { requireCrmOperatorSession } from '@/lib/crm/api-auth';
import { supabase } from '@/lib/supabase';
import type { EscalationReview } from './operator-review';

export type OperatorCommunicationScope = {
  session: { userId: string; email: string };
  accountIds: ReadonlySet<string>;
};

function forbidden(): NextResponse {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}

function normalized(value: unknown): string | null {
  const result = typeof value === 'string' ? value.trim() : '';
  return result || null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function requireOperatorCommunicationScope(): Promise<
  | { error: NextResponse }
  | OperatorCommunicationScope
> {
  const auth = await requireCrmOperatorSession();
  if ('error' in auth) return auth;

  try {
    const membership = await supabase
      .from('account_members')
      .select('account_id')
      .eq('user_id', auth.session.userId);
    if (membership.error) return { error: forbidden() };

    const accountIds = new Set(
      (membership.data ?? [])
        .map((row) => normalized((row as { account_id?: unknown }).account_id))
        .filter((accountId): accountId is string => Boolean(accountId)),
    );
    if (accountIds.size === 0) return { error: forbidden() };

    return { session: auth.session, accountIds };
  } catch {
    return { error: forbidden() };
  }
}

async function lookupAccounts(
  table: 'properties' | 'booking_ops_records',
  column: string,
  value: string,
): Promise<{ ok: true; accountIds: string[] } | { ok: false }> {
  try {
    const result = await supabase.from(table).select('account_id').eq(column, value).limit(2);
    if (result.error) return { ok: false };
    return {
      ok: true,
      accountIds: (result.data ?? [])
        .map((row) => normalized((row as { account_id?: unknown }).account_id))
        .filter((accountId): accountId is string => Boolean(accountId)),
    };
  } catch {
    return { ok: false };
  }
}

type ReservationBinding = {
  id: string;
  accountId: string;
  propertyId: string | null;
};

async function lookupReservationBindings(
  column: 'booking_id' | 'asi_reference' | 'id',
  value: string,
): Promise<{ ok: true; bindings: ReservationBinding[] } | { ok: false }> {
  try {
    const result = await supabase
      .from('booking_ops_records')
      .select('id,account_id,property_id')
      .eq(column, value)
      .limit(2);
    if (result.error) return { ok: false };
    return {
      ok: true,
      bindings: (result.data ?? []).flatMap((row) => {
        const id = normalized((row as { id?: unknown }).id);
        const accountId = normalized((row as { account_id?: unknown }).account_id);
        if (!id || !accountId) return [];
        return [{
          id,
          accountId,
          propertyId: normalized((row as { property_id?: unknown }).property_id),
        }];
      }),
    };
  } catch {
    return { ok: false };
  }
}

async function resolveReservationBinding(reservationId: string): Promise<ReservationBinding | null> {
  const bindings = new Map<string, ReservationBinding>();
  for (const column of ['booking_id', 'asi_reference'] as const) {
    const result = await lookupReservationBindings(column, reservationId);
    if (!result.ok) return null;
    result.bindings.forEach((binding) => bindings.set(binding.id, binding));
  }
  if (isUuid(reservationId)) {
    const result = await lookupReservationBindings('id', reservationId);
    if (!result.ok) return null;
    result.bindings.forEach((binding) => bindings.set(binding.id, binding));
  }
  return bindings.size === 1 ? [...bindings.values()][0]! : null;
}

async function batchLookupAccounts(
  table: 'properties' | 'booking_ops_records',
  column: string,
  values: string[],
): Promise<Map<string, Set<string>> | null> {
  const result = new Map<string, Set<string>>();
  if (values.length === 0) return result;
  try {
    const query = supabase.from(table) as unknown as {
      select: (columns: string) => {
        in: (filterColumn: string, filterValues: string[]) => Promise<{
          data: Array<Record<string, unknown>> | null;
          error: { message: string } | null;
        }>;
      };
    };
    const response = await query.select(`${column},account_id`).in(column, values);
    if (response.error) return null;
    for (const row of response.data ?? []) {
      const key = normalized((row as Record<string, unknown>)[column]);
      const accountId = normalized((row as { account_id?: unknown }).account_id);
      if (!key || !accountId) continue;
      result.set(key, new Set([...(result.get(key) ?? []), accountId]));
    }
    return result;
  } catch {
    return null;
  }
}

async function batchLookupReservationBindings(
  column: 'booking_id' | 'asi_reference' | 'id',
  values: string[],
): Promise<Map<string, Map<string, ReservationBinding>> | null> {
  const result = new Map<string, Map<string, ReservationBinding>>();
  if (values.length === 0) return result;
  try {
    const query = supabase.from('booking_ops_records') as unknown as {
      select: (columns: string) => {
        in: (filterColumn: string, filterValues: string[]) => Promise<{
          data: Array<Record<string, unknown>> | null;
          error: { message: string } | null;
        }>;
      };
    };
    const response = await query.select(`${column},id,account_id,property_id`).in(column, values);
    if (response.error) return null;
    for (const row of response.data ?? []) {
      const key = normalized(row[column]);
      const id = normalized(row.id);
      const accountId = normalized(row.account_id);
      if (!key || !id || !accountId) continue;
      const byId = result.get(key) ?? new Map<string, ReservationBinding>();
      byId.set(id, { id, accountId, propertyId: normalized(row.property_id) });
      result.set(key, byId);
    }
    return result;
  } catch {
    return null;
  }
}

function tenantFromEvidence(params: {
  storedAccountId: string | null;
  propertyId: string | null;
  propertyAccountIds: ReadonlySet<string> | null;
  reservationBinding: ReservationBinding | null;
  reservationPresent: boolean;
}): string | null {
  const candidates = new Set<string>();
  if (params.storedAccountId) candidates.add(params.storedAccountId);

  if (params.propertyId && isUuid(params.propertyId)) {
    if (params.propertyAccountIds?.size !== 1) return null;
    params.propertyAccountIds.forEach((accountId) => candidates.add(accountId));
  }

  if (params.reservationPresent) {
    if (!params.reservationBinding) return null;
    const binding = params.reservationBinding;
    if (params.propertyId) {
      if (!isUuid(params.propertyId) && binding.propertyId !== params.propertyId) return null;
      if (binding.propertyId && binding.propertyId !== params.propertyId) return null;
    }
    candidates.add(binding.accountId);
  } else if (params.propertyId && !isUuid(params.propertyId)) {
    // A text property id is never tenant evidence by itself. It is accepted only
    // through an exact canonical reservation -> property relationship.
    return null;
  }

  return candidates.size === 1 ? [...candidates][0]! : null;
}

/**
 * Resolve the review's tenant from stored scope or canonical property/reservation rows.
 * Any lookup failure, ambiguity, or disagreement fails closed.
 */
export async function resolveEscalationReviewAccountId(
  review: Pick<EscalationReview, 'accountId' | 'propertyId' | 'reservationId'>,
): Promise<string | null> {
  const storedAccountId = normalized(review.accountId);
  const propertyId = normalized(review.propertyId);
  let propertyAccountIds: Set<string> | null = null;
  if (propertyId) {
    if (isUuid(propertyId)) {
      const property = await lookupAccounts('properties', 'id', propertyId);
      if (!property.ok) return null;
      propertyAccountIds = new Set(property.accountIds);
    }
  }

  const reservationId = normalized(review.reservationId);
  let reservationBinding: ReservationBinding | null = null;
  if (reservationId) {
    reservationBinding = await resolveReservationBinding(reservationId);
  }

  return tenantFromEvidence({
    storedAccountId,
    propertyId,
    propertyAccountIds,
    reservationBinding,
    reservationPresent: Boolean(reservationId),
  });
}

export async function resolveTelegramTargetTenantScope(targetId: string): Promise<{
  accountId: string | null;
  propertyId: string | null;
  reservationId: string | null;
}> {
  const chatId = Number(targetId);
  if (!Number.isSafeInteger(chatId)) {
    return { accountId: null, propertyId: null, reservationId: null };
  }
  try {
    const result = await supabase
      .from('tg_conversation_sessions')
      .select('property_id,conversation_context_v1')
      .eq('chat_id', chatId)
      .maybeSingle();
    if (result.error || !result.data) {
      return { accountId: null, propertyId: null, reservationId: null };
    }
    const row = result.data as {
      property_id?: unknown;
      conversation_context_v1?: unknown;
    };
    const context = row.conversation_context_v1 && typeof row.conversation_context_v1 === 'object'
      ? row.conversation_context_v1 as Record<string, unknown>
      : {};
    const currentObject = context.current_object && typeof context.current_object === 'object'
      ? context.current_object as Record<string, unknown>
      : {};
    const currentBooking = context.current_booking && typeof context.current_booking === 'object'
      ? context.current_booking as Record<string, unknown>
      : {};
    const storedPropertyId = normalized(row.property_id);
    const contextPropertyId = normalized(currentObject.property_id);
    if (storedPropertyId && contextPropertyId && storedPropertyId !== contextPropertyId) {
      return { accountId: null, propertyId: null, reservationId: null };
    }
    const propertyId = storedPropertyId ?? contextPropertyId;
    const reservationId = normalized(currentBooking.reservation_id);
    const accountId = await resolveEscalationReviewAccountId({
      propertyId: propertyId ?? undefined,
      reservationId: reservationId ?? undefined,
    });
    return { accountId, propertyId, reservationId };
  } catch {
    return { accountId: null, propertyId: null, reservationId: null };
  }
}

/** Resolve a collection with at most four canonical lookups instead of one lookup per review. */
export async function resolveEscalationReviewAccountIds(
  reviews: EscalationReview[],
): Promise<Map<string, string | null>> {
  const propertyIds = [...new Set(reviews
    .map((review) => normalized(review.propertyId))
    .filter((value): value is string => typeof value === 'string' && isUuid(value)))];
  const reservationIds = [...new Set(reviews
    .map((review) => normalized(review.reservationId))
    .filter((value): value is string => Boolean(value)))];
  const reservationUuidIds = reservationIds.filter(isUuid);

  const [properties, bookings, references, recordIds] = await Promise.all([
    batchLookupAccounts('properties', 'id', propertyIds),
    batchLookupReservationBindings('booking_id', reservationIds),
    batchLookupReservationBindings('asi_reference', reservationIds),
    batchLookupReservationBindings('id', reservationUuidIds),
  ]);
  const resolved = new Map<string, string | null>();
  if (!properties || !bookings || !references || !recordIds) {
    reviews.forEach((review) => resolved.set(review.reviewId, null));
    return resolved;
  }

  for (const review of reviews) {
    const storedAccountId = normalized(review.accountId);
    const propertyId = normalized(review.propertyId);
    const reservationId = normalized(review.reservationId);
    let reservationBinding: ReservationBinding | null = null;
    if (reservationId) {
      const bindings = new Map<string, ReservationBinding>();
      for (const source of [bookings, references, recordIds]) {
        source.get(reservationId)?.forEach((binding, id) => bindings.set(id, binding));
      }
      reservationBinding = bindings.size === 1 ? [...bindings.values()][0]! : null;
    }

    resolved.set(review.reviewId, tenantFromEvidence({
      storedAccountId,
      propertyId,
      propertyAccountIds: propertyId && isUuid(propertyId) ? (properties.get(propertyId) ?? null) : null,
      reservationBinding,
      reservationPresent: Boolean(reservationId),
    }));
  }
  return resolved;
}

export async function requireEscalationReviewScope(
  scope: OperatorCommunicationScope,
  review: EscalationReview,
): Promise<{ accountId: string } | { error: NextResponse }> {
  const accountId = await resolveEscalationReviewAccountId(review);
  if (!accountId || !scope.accountIds.has(accountId)) return { error: forbidden() };
  return { accountId };
}
