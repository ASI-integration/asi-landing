'use client';

import { useSession } from '@/contexts/SessionContext';
import { LifecycleProgress } from '@/components/billing/LifecycleProgress';

export default function BillingStatusPage() {
  const { session, loading } = useSession();

  if (loading) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Account setup</h1>
        </header>
        <div className="animate-spin w-6 h-6 border-2 border-slate-900 border-t-transparent rounded-full" />
      </div>
    );
  }

  const account = session?.account;
  const status = (account?.lifecycle_status as
    | 'signup'
    | 'card_verified'
    | 'integration_in_progress'
    | 'integration_ready'
    | 'trial_active'
    | 'paid_active'
    | null
    | undefined) ?? null;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Account setup</h1>
        <p className="mt-1 text-slate-600">
          Nothing is charged today. See exactly where your account stands below.
        </p>
      </header>

      <LifecycleProgress status={status} trialEndsAt={account?.trial_ends_at ?? null} />
    </div>
  );
}
