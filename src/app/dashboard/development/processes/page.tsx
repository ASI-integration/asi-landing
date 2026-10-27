import { DevelopmentOwnerGuard } from '@/components/DevelopmentOwnerGuard';
import ProcessesClient from './ProcessesClient';
export const metadata = {title:'Панель процессов | ASI'};
export default function ProcessesPage() {
  return <DevelopmentOwnerGuard><ProcessesClient /></DevelopmentOwnerGuard>;
}
