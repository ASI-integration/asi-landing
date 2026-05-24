import { redirect } from 'next/navigation';

/** Legacy route — canonical UI is channel connections. */
export default function DataSourcePage() {
  redirect('/dashboard/channel-connections');
}
