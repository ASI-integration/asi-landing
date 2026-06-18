import { PropertySetupClient } from '@/components/dashboard/PropertySetupClient';

type PageProps = { params: { id: string } };

export default function PropertySetupPage({ params }: PageProps) {
  return <PropertySetupClient propertyId={params.id} />;
}
