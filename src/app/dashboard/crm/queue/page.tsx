import CrmQueuePageClient from './CrmQueuePageClient';
import { CrmAccessGuard } from '@/components/CrmAccessGuard';

export const metadata = {
  title: 'Очередь заявок | ASI',
};

export default function CrmQueuePage() {
  return (
    <CrmAccessGuard>
      <CrmQueuePageClient />
    </CrmAccessGuard>
  );
}
