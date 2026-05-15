import type { Metadata } from 'next';
import { LocationStandaloneFullReport } from '@/components/location/LocationStandaloneFullReport';
import { sampleStrLocationStandaloneReportRu } from '@/lib/location/standalone-report';
import { ThemeProvider } from '@/theme/ThemeProvider';

export const metadata: Metadata = {
  title: 'Пример отчёта по посуточной аренде — ASI',
  description:
    'Демонстрационный пример полного отчёта ASI по потенциалу локации для посуточной аренды.',
  robots: { index: false, follow: false },
};

export default function RuLocationReportSamplePage() {
  return (
    <ThemeProvider defaultTheme="light" className="theme-transition min-h-screen bg-[var(--t-bg)] text-[var(--t-text)]">
      <LocationStandaloneFullReport report={sampleStrLocationStandaloneReportRu} />
    </ThemeProvider>
  );
}
