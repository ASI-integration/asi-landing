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

/**
 * Resolve the review's tenant from stored scope or canonical property/reservation rows.
 * Any lookup failure, ambiguity, or disagreement fails closed.
 */
export async function resolveEscalationReviewAccountId(review: EscalationReview): Promise<string | null> {
  const candidates = new Set<string>();
  const storedAccountId = normalized(review.accountId);
  if (storedAccountId) candidates.add(storedAccountId);

  const propertyId = normalized(review.propertyId);
  if (propertyId) {
    if (!isUuid(propertyId)) return null;
    const property = await lookupAccounts('properties', 'id', propertyId);
    if (!property.ok || property.accountIds.length !== 1) return null;
    candidates.add(property.accountIds[0]!);
  }

  const reservationId = normalized(review.reservationId);
  if (reservationId) {
    const reservationAccounts = new Set<string>();
    for (const column of ['booking_id', 'asi_reference']) {
      const result = await lookupAccounts('booking_ops_records', column, reservationId);
      if (!result.ok) return null;
      result.accountIds.forEach((accountId) => reservationAccounts.add(accountId));
    }
    if (isUuid(reservationId)) {
      const result = await lookupAccounts('booking_ops_records', 'id', reservationId);
      if (!result.ok) return null;
      result.accountIds.forEach((accountId) => reservationAccounts.add(accountId));
    }
    if (reservationAccounts.size !== 1) return null;
    candidates.add([...reservationAccounts][0]!);
  }

  return candidates.size === 1 ? [...candidates][0]! : null;
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
    batchLookupAccounts('booking_ops_records', 'booking_id', reservationIds),
    batchLookupAccounts('booking_ops_records', 'asi_reference', reservationIds),
    batchLookupAccounts('booking_ops_records', 'id', reservationUuidIds),
  ]);
  const resolved = new Map<string, string | null>();
  if (!properties || !bookings || !references || !recordIds) {
    reviews.forEach((review) => resolved.set(review.reviewId, null));
    return resolved;
  }

  for (const review of reviews) {
    const candidates = new Set<string>();
    const storedAccountId = normalized(review.accountId);
    if (storedAccountId) candidates.add(storedAccountId);

    const propertyId = normalized(review.propertyId);
    if (propertyId) {
      const accounts = isUuid(propertyId) ? properties.get(propertyId) : null;
      if (accounts?.size !== 1) {
        resolved.set(review.reviewId, null);
        continue;
      }
      accounts.forEach((accountId) => candidates.add(accountId));
    }

    const reservationId = normalized(review.reservationId);
    if (reservationId) {
      const accounts = new Set<string>([
        ...(bookings.get(reservationId) ?? []),
        ...(references.get(reservationId) ?? []),
        ...(recordIds.get(reservationId) ?? []),
      ]);
      if (accounts.size !== 1) {
        resolved.set(review.reviewId, null);
        continue;
      }
      accounts.forEach((accountId) => candidates.add(accountId));
    }

    resolved.set(review.reviewId, candidates.size === 1 ? [...candidates][0]! : null);
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
