import { Suspense } from 'react';
import { DevelopmentOwnerGuard } from '@/components/DevelopmentOwnerGuard';
import DevelopmentConsoleClient from './DevelopmentConsoleClient';

export const metadata = {
  title: 'Разработка ASI | ASI',
};

export default function DevelopmentPage() {
  return (
    <DevelopmentOwnerGuard>
      <Suspense
        fallback={
          <div className="flex min-h-[40vh] items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-900 border-t-transparent" />
          </div>
        }
      >
        <DevelopmentConsoleClient />
      </Suspense>
    </DevelopmentOwnerGuard>
  );
}
