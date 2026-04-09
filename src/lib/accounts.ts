import { supabase } from '@/lib/supabase';

export type PlanCode = 'small' | 'growth' | 'enterprise';

type EnsureAccountResult = {
  accountId: string;
  created: boolean;
};

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function normalizePlan(plan: unknown): PlanCode {
  if (plan === 'small' || plan === 'growth' || plan === 'enterprise') return plan;
  return 'small';
}

export async function ensureAccountForUser(opts: {
  userId: string;
  email: string;
  selectedPlan?: unknown;
  trialDays?: number;
}): Promise<EnsureAccountResult> {
  const plan = normalizePlan(opts.selectedPlan);
  const trialDays = typeof opts.trialDays === 'number' && opts.trialDays > 0 ? opts.trialDays : 7;

  // 1) Try to find existing membership -> account
  let membership: any = null;
  try {
    const { data, error } = await supabase
      .from('account_members')
      .select('account_id, role, accounts:account_id ( id, plan_code, trial_started_at, trial_ends_at, subscription_status )')
      .eq('user_id', opts.userId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    membership = data;
  } catch (e: any) {
    const msg = typeof e?.message === 'string' ? e.message : '';
    // Backward-compat: production DB may not have multitenant tables yet.
    if (msg.includes('account_members') && (msg.includes('does not exist') || msg.includes('relation'))) {
      return { accountId: 'legacy', created: false };
    }
    throw e;
  }

  const now = new Date();
  const trialEnds = addDays(now, trialDays);

  // 2) If membership exists, update plan/trial on account (idempotent)
  if (membership?.account_id) {
    const accountId = membership.account_id as string;
    const acct: any = (membership as any).accounts;

    const patch: Record<string, any> = {};
    if (acct?.plan_code !== plan) patch.plan_code = plan;
    if (!acct?.trial_started_at) patch.trial_started_at = now.toISOString();
    if (!acct?.trial_ends_at) patch.trial_ends_at = trialEnds.toISOString();
    if (acct?.subscription_status !== 'trial') patch.subscription_status = 'trial';
    if (Object.keys(patch).length) {
      const { error: upErr } = await supabase.from('accounts').update(patch).eq('id', accountId);
      if (upErr) throw upErr;
    }

    return { accountId, created: false };
  }

  // 3) Otherwise create account + membership
  const accountName = (opts.email || 'ASI workspace').split('@')[0]?.trim() || 'ASI workspace';
  try {
    const { data: account, error: accountErr } = await supabase
      .from('accounts')
      .insert({
        name: accountName,
        plan_code: plan,
        subscription_status: 'trial',
        trial_started_at: now.toISOString(),
        trial_ends_at: trialEnds.toISOString(),
      })
      .select('id')
      .single();

    if (accountErr) throw accountErr;

    const { error: memberErr } = await supabase.from('account_members').insert({
      account_id: account.id,
      user_id: opts.userId,
      role: 'owner',
    });
    if (memberErr) throw memberErr;

    return { accountId: account.id, created: true };
  } catch (e: any) {
    const msg = typeof e?.message === 'string' ? e.message : '';
    if ((msg.includes('accounts') || msg.includes('account_members')) && (msg.includes('does not exist') || msg.includes('relation'))) {
      return { accountId: 'legacy', created: false };
    }
    throw e;
  }
}

