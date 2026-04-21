import type { Metadata } from 'next';
import { LocationIntelligenceDemo } from '@/components/LocationIntelligenceDemo';
import type { LocationAnalysisMode } from '@/components/LocationIntelligenceDemo';
import { LocationTelemetryProvider } from '@/context/landing-location-telemetry';
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';
import { RuComplianceFooter } from '@/components/ru/RuComplianceFooter';
import { ThemeProvider } from '@/theme/ThemeProvider';

export const metadata: Metadata = {
  title: 'Оценка локации — ASI',
  description:
    'Введите адрес — ASI покажет спрос, конкуренцию, магниты трафика, структуру потока и форматный потенциал точки.',
};

export default async function RuLocationAnalysisPage(
  props: { searchParams: Promise<{ mode?: string }> },
) {
  const searchParams = await props.searchParams;
  const mode: LocationAnalysisMode =
    searchParams.mode === 'commercial' ? 'commercial' : 'residential';

  return (
    <ThemeProvider defaultTheme="midnight" className="min-h-screen bg-slate-950 text-white">
      <LocationTelemetryProvider>

        <RuPublicNavHeader surface="dark" density="landing" />

        <main>
          <LocationIntelligenceDemo locale="ru" initialMode={mode} edgeToHeader />
        </main>

        <RuComplianceFooter />

      </LocationTelemetryProvider>
    </ThemeProvider>
  );
}
