import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

type PaymentsSupabaseClient = Pick<SupabaseClient, 'from'>;

let testClient: PaymentsSupabaseClient | null | undefined;

export function getPaymentsSupabase(): PaymentsSupabaseClient | null {
  if (testClient !== undefined) return testClient;
  if (process.env.NODE_ENV === 'test') return null;

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return supabase;
}

/** Test-only seam; pass undefined to restore environment-based resolution. */
export function _setPaymentsSupabaseForTesting(
  client: PaymentsSupabaseClient | null | undefined,
): void {
  testClient = client;
}
