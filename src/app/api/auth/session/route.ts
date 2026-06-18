import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getSession, isSessionSecretConfigured } from '@/lib/auth';
import { isDashboardInternalUser } from '@/lib/dashboard/internal-access';
import { supabase } from '@/lib/supabase';

const emptySessionPayload = { user: null, subscription: null, account: null };

export async function GET() {
  const cookieHeader = headers().get('cookie') || '';
  if (!isSessionSecretConfigured()) {
    console.warn('[Session] SESSION_SECRET is not configured; returning empty session');
    return NextResponse.json(emptySessionPayload);
  }

  let session: Awaited<ReturnType<typeof getSession>>;
  try {
    session = await getSession();
  } catch (e) {
    console.warn('[Session] getSession failed; returning empty session', e);
    return NextResponse.json(emptySessionPayload);
  }
  console.info('[Session] request', {
    hasCookieHeader: Boolean(cookieHeader),
    cookieLen: cookieHeader.length,
    hasUserId: Boolean(session.userId),
  });
  if (!session.userId) {
    return NextResponse.json({ user: null, subscription: null, account: null });
  }

  const { data: sub } = await supabase
    .from('subscriptions')
    .select('status, trial_end, current_period_end')
    .eq('user_id', session.userId)
    .single();

  let account: unknown = null;
  try {
    const { data: membership } = await supabase
      .from('account_members')
      .select('account_id, accounts:account_id ( id, name, plan_code, subscription_status, trial_started_at, trial_ends_at )')
      .eq('user_id', session.userId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    account = membership?.accounts ?? null;
  } catch (e) {
    // If the multitenant account layer isn't deployed yet, don't break the entire session endpoint.
    console.warn('[Session] account lookup failed; returning account=null', e);
    account = null;
  }

  return NextResponse.json({
    user: { id: session.userId, email: session.email },
    subscription: sub,
    account,
    isInternal: isDashboardInternalUser(session.email),
  });
}
