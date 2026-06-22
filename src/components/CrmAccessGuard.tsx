'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from '@/contexts/SessionContext';

export function CrmAccessGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { session, loading } = useSession();

  useEffect(() => {
    if (loading) return;
    if (session?.user && session.isCrmOperator === false) {
      router.replace('/dashboard');
    }
  }, [session, loading, router]);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-900 border-t-transparent" />
      </div>
    );
  }

  if (!session?.user) {
    return null;
  }

  if (session.isCrmOperator === false) {
    return (
      <div className="mx-auto max-w-lg rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Нет доступа</h1>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed">
          Раздел CRM доступен только операторам ASI.
        </p>
        <Link
          href="/dashboard"
          className="mt-5 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          Вернуться в кабинет
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
