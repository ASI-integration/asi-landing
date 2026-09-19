import { ChannelConnectionsPanel } from '@/components/dashboard/ChannelConnectionsPanel';
import { ChannelManagerConnectionFlow } from '@/components/dashboard/ChannelManagerConnectionFlow';
import { RentalConnectionFlow } from '@/components/dashboard/RentalConnectionFlow';

type PageProps = {
  searchParams?: {
    contactId?: string;
    objectId?: string;
    source?: string;
    setup?: string;
  };
};

export default function ChannelConnectionsPage({ searchParams }: PageProps) {
  if (searchParams?.setup === '1') return <RentalConnectionFlow />;
  const contactId = searchParams?.contactId?.trim() ?? '';
  const objectId = searchParams?.objectId?.trim() ?? '';
  const source = searchParams?.source?.trim() || 'dashboard';

  if (contactId && objectId) {
    return (
      <div className="space-y-10">
        <ChannelManagerConnectionFlow contactId={contactId} objectId={objectId} source={source} />
        <details className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <summary className="cursor-pointer text-sm font-medium text-slate-600">
            Справка по подключениям каналов
          </summary>
          <div className="mt-4">
            <ChannelConnectionsPanel compact />
          </div>
        </details>
      </div>
    );
  }

  return <ChannelConnectionsPanel />;
}
