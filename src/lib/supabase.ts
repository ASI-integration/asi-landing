import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient {
  if (!_supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Supabase env vars not configured');
    _supabase = createClient(url, key, { auth: { persistSession: false } });
  }
  return _supabase;
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_, prop) {
    return getSupabase()[prop as keyof SupabaseClient];
  },
});

export type User = {
  id: string;
  email: string;
  password_hash: string;
  telegram_id: string | null;
  created_at: string;
};

export type Subscription = {
  id: string;
  user_id: string;
  status: 'trial' | 'active' | 'past_due' | 'canceled';
  trial_start: string;
  trial_end: string;
  current_period_end: string | null;
  payment_method_id: string | null;
  created_at: string;
};

export type Payment = {
  id: string;
  user_id: string;
  yookassa_payment_id: string;
  amount: number;
  status: string;
  created_at: string;
};
