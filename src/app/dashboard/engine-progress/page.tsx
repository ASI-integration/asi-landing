import { DevelopmentOwnerGuard } from '@/components/DevelopmentOwnerGuard';
import EngineProgressClient from './EngineProgressClient';

export const metadata = { title: 'Вехи диспетчера и движка | ASI' };

export default function EngineProgressPage() {
  return (
    <DevelopmentOwnerGuard>
      <EngineProgressClient />
    </DevelopmentOwnerGuard>
  );
}
