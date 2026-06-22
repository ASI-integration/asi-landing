import OpsPageClient from './OpsPageClient';
import { CrmAccessGuard } from '@/components/CrmAccessGuard';

export const metadata = {
  title: 'Операции | ASI',
};

export default function OpsPage() {
  return (
    <CrmAccessGuard>
      <OpsPageClient />
    </CrmAccessGuard>
  );
}
