import CrmPageClient from '../crm/CrmPageClient';
import { CrmAccessGuard } from '@/components/CrmAccessGuard';

export const metadata = {
  title: 'Заявки пилота | ASI',
};

export default function LeadsPage() {
  return (
    <CrmAccessGuard>
      <CrmPageClient />
    </CrmAccessGuard>
  );
}
