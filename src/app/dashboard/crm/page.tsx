import CrmPageClient from './CrmPageClient';
import { CrmAccessGuard } from '@/components/CrmAccessGuard';

export const metadata = {
  title: 'CRM раннего доступа | ASI',
};

export default function CrmPage() {
  return (
    <CrmAccessGuard>
      <CrmPageClient />
    </CrmAccessGuard>
  );
}
