import type { Metadata } from 'next';
import { Suspense } from 'react';
import PilotConsoleClient from './PilotConsoleClient';

/**
 * Engineering Pilot Console — invite/internal tooling.
 * Not the commercial customer pilot (`/ru/early-access`).
 * Kept out of RU public nav; de-indexed from public search.
 */
export const metadata: Metadata = {
  title: 'Pilot Console | ASI',
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
};

export default function PilotPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-50">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-900 border-t-transparent" />
        </div>
      }
    >
      <PilotConsoleClient />
    </Suspense>
  );
}
