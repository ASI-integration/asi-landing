import { Suspense } from 'react';
import { DevelopmentOwnerGuard } from '@/components/DevelopmentOwnerGuard';
import RoadmapDashboardClient from './RoadmapDashboardClient';

export const metadata = {
  title: 'План ASI | ASI',
};

export default function RoadmapPage() {
  return (
    <DevelopmentOwnerGuard>
      <Suspense
        fallback={
          <div className="flex min-h-[40vh] items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-900 border-t-transparent" />
          </div>
        }
      >
        <RoadmapDashboardClient />
      </Suspense>
    </DevelopmentOwnerGuard>
  );
}
