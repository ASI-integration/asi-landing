import { Suspense } from 'react';
import PilotConsoleClient from './PilotConsoleClient';

export const metadata = {
  title: 'Pilot Console | ASI',
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
