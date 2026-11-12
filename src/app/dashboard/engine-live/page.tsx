import { DevelopmentOwnerGuard } from '@/components/DevelopmentOwnerGuard';
import EngineLiveClient from './EngineLiveClient';

export const metadata = { title: 'ASI Engine · Live monitoring | GuestAutopilot' };

export default function EngineLivePage() {
  return <DevelopmentOwnerGuard><EngineLiveClient /></DevelopmentOwnerGuard>;
}
