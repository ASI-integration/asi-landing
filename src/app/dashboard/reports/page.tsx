import { Suspense } from 'react';
import { ReportsPageClient } from './ReportsPageClient';

export default function DashboardReportsPage() {
  return (
    <Suspense fallback={<div className="text-slate-500">Загружаем отчёты…</div>}>
      <ReportsPageClient />
    </Suspense>
  );
}
