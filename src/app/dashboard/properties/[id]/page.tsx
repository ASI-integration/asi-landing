import { PropertyDetailClient } from '@/components/dashboard/PropertyDetailClient';

type PageProps = { params: { id: string } };

export default function PropertyDetailPage({ params }: PageProps) {
  return <PropertyDetailClient propertyId={params.id} />;
}
