import type { Metadata } from 'next';
import { LocationReportProductView } from '@/components/location/LocationReportProductView';
import { sampleFullLocationReportRu } from '@/lib/location/report-contract';

export const metadata: Metadata = {
  title: 'Пример полного отчёта по локации — ASI',
  description:
    'Демонстрационный sample полного отчёта ASI по потенциалу локации: структура, ограничения, confidence и print/PDF view.',
  robots: { index: false, follow: false },
};

export default function RuLocationReportSamplePage() {
  return <LocationReportProductView report={sampleFullLocationReportRu} />;
}
