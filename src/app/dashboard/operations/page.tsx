import OperationsPageClient from './OperationsPageClient';
import { CrmAccessGuard } from '@/components/CrmAccessGuard';

export const metadata = {
  title: 'Операции | ASI',
};

export default function OperationsPage() {
  return (
    <CrmAccessGuard>
      <OperationsPageClient />
    </CrmAccessGuard>
  );
}
