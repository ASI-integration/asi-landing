import type { Metadata } from 'next';
import Link from 'next/link';
import { LocationIntelligenceDemo } from '@/components/LocationIntelligenceDemo';
import type { LocationAnalysisMode } from '@/components/LocationIntelligenceDemo';
import { LocationTelemetryProvider } from '@/context/landing-location-telemetry';
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';
import { RuComplianceFooter } from '@/components/ru/RuComplianceFooter';
import { ThemeProvider } from '@/theme/ThemeProvider';

export const metadata: Metadata = {
  title: 'Оценка локации — ASI',
  description:
    'Быстрый демо‑предпросмотр: введите адрес — получите предварительную оценку. Полный отчёт формируется асинхронно и может занять до ~1 минуты.',
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
          <section id="location-check" className="scroll-mt-20">
            <LocationIntelligenceDemo locale="ru" initialMode={mode} edgeToHeader />
          </section>

          <section
            aria-labelledby="location-analysis-connect-heading"
            className="border-t border-slate-800/60 bg-slate-950 px-4 py-14 sm:px-6 sm:py-20"
          >
            <div className="mx-auto max-w-3xl text-center">
              <h2
                id="location-analysis-connect-heading"
                className="text-2xl font-bold tracking-tight text-white sm:text-3xl"
              >
                Хотите понять, как использовать эту локацию?
              </h2>
              <p className="mt-4 text-base leading-relaxed text-slate-300 sm:text-lg">
                Мы можем разобрать объект глубже: спрос, гостей, риски, цену, конкурентов и стратегию запуска. Это помогает
                понять, стоит ли заходить в объект и как быстрее вывести его на доход.
              </p>
              <Link
                href="/ru/otchet-po-dohodnosti-obektov"
                className="mt-8 inline-flex min-w-[min(100%,280px)] items-center justify-center rounded-xl bg-white px-8 py-4 text-base font-bold text-slate-900 shadow-lg transition-colors hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
              >
                Получить полный отчёт
              </Link>
            </div>
          </section>
        </main>

        <RuComplianceFooter />

      </LocationTelemetryProvider>
    </ThemeProvider>
  );
}
