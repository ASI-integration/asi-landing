import { DevelopmentOwnerGuard } from '@/components/DevelopmentOwnerGuard';
import StrigunovGpsClient from './StrigunovGpsClient';

export const metadata = {title: 'GPS проекта «Стригунов 4» | ASI'};

export default function StrigunovGpsPage() {
  return <DevelopmentOwnerGuard><StrigunovGpsClient /></DevelopmentOwnerGuard>;
}
