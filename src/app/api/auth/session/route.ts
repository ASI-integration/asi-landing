import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { getSession, isSessionSecretConfigured } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { isCrmOperatorEmail, isOpsAdminEmail } from '@/lib/crm/access';
import { isDevelopmentOwnerEmail } from '@/lib/development/access';
import { getIsRuHost } from '@/lib/getIsRuHost';

const emptySessionPayload = { user: null, subscription: null, account: null, ruCommercialPilot: null };

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
    return NextResponse.json({ user: null, subscription: null, account: null, ruCommercialPilot: null });
  }

  const { data: sub } = await supabase
    .from('subscriptions')
    .select('status, trial_end, current_period_end')
    .eq('user_id', session.userId)
    .single();

  let account: unknown = null;
  let accountId: string | null = null;
  try {
    const { data: membership } = await supabase
      .from('account_members')
      .select('account_id, accounts:account_id ( id, name, plan_code, subscription_status, trial_started_at, trial_ends_at, lifecycle_status, card_verified_at, integration_started_at, integration_ready_at, billing_started_at )')
      .eq('user_id', session.userId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    account = membership?.accounts ?? null;
    accountId = (membership?.account_id as string | undefined) ?? null;
  } catch (e) {
    // If the multitenant account layer isn't deployed yet, don't break the entire session endpoint.
    console.warn('[Session] account lookup failed; returning account=null', e);
    account = null;
  }

  let ruCommercialPilot: { status: string; pilot_started_at: string | null; pilot_ends_at: string | null } | null = null;
  if (accountId && await getIsRuHost()) {
    const { data: pilot, error: pilotError } = await supabase
      .from('ru_commercial_pilot_lifecycle')
      .select('status, pilot_started_at, pilot_ends_at')
      .eq('account_id', accountId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pilotError) console.warn('[Session] RU pilot lookup failed', pilotError);
    ruCommercialPilot = pilot
      ? {
          status: pilot.status,
          pilot_started_at: pilot.pilot_started_at,
          pilot_ends_at: pilot.pilot_ends_at,
        }
      : { status: 'not_started', pilot_started_at: null, pilot_ends_at: null };
  }

  return NextResponse.json({
    user: { id: session.userId, email: session.email },
    subscription: sub,
    account,
    ruCommercialPilot,
    isCrmOperator: isCrmOperatorEmail(session.email),
    isOpsAdmin: isOpsAdminEmail(session.email),
    isDevelopmentOwner: isDevelopmentOwnerEmail(session.email),
  });
}
