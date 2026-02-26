'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '@/contexts/SessionContext';

export function DashboardAuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { session, loading } = useSession();

  useEffect(() => {
    if (loading) return;
    if (!session?.user) {
      router.replace('/signup');
    }
  }, [session, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-2 border-slate-900 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!session?.user) {
    return null;
  }

  if (session.subscription?.status === 'past_due') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-sm p-6 text-center">
          <h1 className="text-xl font-bold text-slate-900">Payment required</h1>
          <p className="mt-2 text-slate-600">
            Your trial has ended. Please update your payment method to continue.
          </p>
          <a
            href="/dashboard/billing"
            className="mt-6 inline-block px-6 py-3 bg-slate-900 text-white font-medium rounded-lg hover:bg-slate-800"
          >
            Update payment
          </a>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
