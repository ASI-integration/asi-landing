import { DevelopmentOwnerGuard } from '@/components/DevelopmentOwnerGuard';
import MissionControlClient from './MissionControlClient';

export const metadata = {
  title: 'Центр управления | ASI',
};

export default function ControlCenterPage() {
  return (
    <DevelopmentOwnerGuard>
      <MissionControlClient />
    </DevelopmentOwnerGuard>
  );
}
