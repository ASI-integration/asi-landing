import { DevelopmentOwnerGuard } from '@/components/DevelopmentOwnerGuard';
import EngineProgressClient from './EngineProgressClient';
import StrigunovProgress from './StrigunovProgress';

export const metadata = { title: 'Прогресс ASI · Стригунов 4 и движок' };

export default function EngineProgressPage() {
  return (
    <DevelopmentOwnerGuard>
      <StrigunovProgress />
      <EngineProgressClient />
    </DevelopmentOwnerGuard>
  );
}
