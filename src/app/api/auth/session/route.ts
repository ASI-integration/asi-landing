import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

export async function GET() {
  const session = await getSession();
  if (!session.userId) {
    return NextResponse.json({ user: null, subscription: null });
  }

  const { data: sub } = await supabase
    .from('subscriptions')
    .select('status, trial_end, current_period_end')
    .eq('user_id', session.userId)
    .single();

  return NextResponse.json({
    user: { id: session.userId, email: session.email },
    subscription: sub,
  });
}
