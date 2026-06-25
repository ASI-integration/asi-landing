import { Suspense } from 'react';
import OpsPageClient from './OpsPageClient';
import { CrmAccessGuard } from '@/components/CrmAccessGuard';

export const metadata = {
  title: 'Операции | ASI',
};

export default function OpsPage() {
  return (
    <CrmAccessGuard>
      <Suspense fallback={<div className="p-6 text-slate-500">Загружаем операции…</div>}>
        <OpsPageClient />
      </Suspense>
    </CrmAccessGuard>
  );
}
