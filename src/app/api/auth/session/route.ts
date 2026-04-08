import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ user: null, subscription: null, account: null });
  }

  const { data: sub } = await supabase
    .from('subscriptions')
    .select('status, trial_end, current_period_end')
    .eq('user_id', session.userId)
    .single();

  const { data: membership } = await supabase
    .from('account_members')
    .select('account_id, accounts:account_id ( id, name, plan_code, subscription_status, trial_started_at, trial_ends_at )')
    .eq('user_id', session.userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    user: { id: session.userId, email: session.email },
    subscription: sub,
    account: membership?.accounts ?? null,
  });
}
