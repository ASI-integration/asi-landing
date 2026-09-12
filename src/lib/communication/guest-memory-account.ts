import { supabase } from '@/lib/supabase';

type SupabaseLike = { from: (table: string) => any };

function normalized(value: unknown): string | null {
  const result = typeof value === 'string' ? value.trim() : '';
  return result || null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Resolve a single proven tenant account for guest memory.
 *
 * Fail-closed rules:
 * - never treat propertyId as accountId
 * - never guess from the first/only row across tenants
 * - ambiguous or conflicting evidence returns null
 */
export async function resolveGuestMemoryAccountId(input: {
  reservationId?: string | null;
  propertyId?: string | null;
  db?: SupabaseLike;
}): Promise<string | null> {
  const db = input.db ?? (supabase as unknown as SupabaseLike);
  const reservationId = normalized(input.reservationId);
  const propertyId = normalized(input.propertyId);

  const candidates = new Set<string>();

  if (reservationId) {
    const fromReservation = await resolveAccountFromReservation(reservationId, db);
    if (fromReservation === false) return null;
    if (fromReservation) candidates.add(fromReservation);
  }

  if (propertyId) {
    const fromProperty = await resolveAccountFromProperty(propertyId, db);
    if (fromProperty === false) return null;
    if (fromProperty) candidates.add(fromProperty);
  }

  if (candidates.size !== 1) return null;
  const accountId = [...candidates][0]!;
  // Defense in depth: never accept a value that is literally the property id.
  if (propertyId && accountId === propertyId) return null;
  return accountId;
}

async function resolveAccountFromProperty(
  propertyId: string,
  db: SupabaseLike,
): Promise<string | null | false> {
  // Canonical properties.id is UUID. Non-UUID legacy text ids are not trusted
  // as a direct properties lookup without a separate binding migration.
  if (!isUuid(propertyId)) return null;
  try {
    const result = await db.from('properties').select('account_id').eq('id', propertyId).limit(2);
    if (result?.error) return false;
    const accounts = uniqueAccountIds(result?.data);
    if (accounts.length > 1) return false;
    return accounts[0] ?? null;
  } catch {
    return false;
  }
}

async function resolveAccountFromReservation(
  reservationId: string,
  db: SupabaseLike,
): Promise<string | null | false> {
  const accounts = new Set<string>();
  for (const column of ['booking_id', 'asi_reference'] as const) {
    const resolved = await lookupReservationAccounts(column, reservationId, db);
    if (resolved === false) return false;
    resolved.forEach((accountId) => accounts.add(accountId));
  }
  if (isUuid(reservationId)) {
    const resolved = await lookupReservationAccounts('id', reservationId, db);
    if (resolved === false) return false;
    resolved.forEach((accountId) => accounts.add(accountId));
  }
  if (accounts.size > 1) return false;
  return accounts.size === 1 ? [...accounts][0]! : null;
}

async function lookupReservationAccounts(
  column: 'booking_id' | 'asi_reference' | 'id',
  value: string,
  db: SupabaseLike,
): Promise<string[] | false> {
  try {
    const result = await db
      .from('booking_ops_records')
      .select('account_id')
      .eq(column, value)
      .limit(2);
    if (result?.error) return false;
    return uniqueAccountIds(result?.data);
  } catch {
    return false;
  }
}

function uniqueAccountIds(rows: unknown): string[] {
  const accounts = new Set<string>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const accountId = normalized((row as { account_id?: unknown })?.account_id);
    if (accountId) accounts.add(accountId);
  }
  return [...accounts];
}
