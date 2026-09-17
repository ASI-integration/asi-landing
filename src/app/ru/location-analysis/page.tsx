import type { Metadata } from 'next';
import {
  BrandGoldRule,
  BrandHeadline,
  BrandLogoMark,
  BrandPrimaryCta,
} from '@/components/brand';
import { LocationIntelligenceDemo } from '@/components/LocationIntelligenceDemo';
import type { LocationAnalysisMode } from '@/components/LocationIntelligenceDemo';
import { RuComplianceFooter } from '@/components/ru/RuComplianceFooter';
import { RuLocationProductNav } from '@/components/ru/RuLocationProductNav';
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';
import { LocationTelemetryProvider } from '@/context/landing-location-telemetry';

export const metadata: Metadata = {
  title: 'Оценка локации — ASI',
  description:
    'Введите адрес и получите общий вывод по потенциалу объекта. Подробный отчёт доступен в личном кабинете ASI.',
};

export default async function RuLocationAnalysisPage(props: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const searchParams = await props.searchParams;
  const mode: LocationAnalysisMode =
    searchParams.mode === 'commercial' ? 'commercial' : 'residential';

  return (
    <div className="font-sans bg-asi-ivory text-asi-navy antialiased">
      <LocationTelemetryProvider>
        <RuPublicNavHeader density="landing" />

        <main>
          <section className="relative bg-asi-ivory px-5 sm:px-8 pt-12 sm:pt-16 pb-10 sm:pb-14 overflow-hidden">
            <div className="max-w-6xl mx-auto">
              <RuLocationProductNav currentPath="/ru/location-analysis" />
              <div className="grid lg:grid-cols-[1.15fr,0.85fr] gap-10 lg:gap-14 items-center">
                <div>
                  <div className="flex items-center gap-3">
                    <BrandLogoMark size={34} />
                    <span className="font-serif text-2xl text-asi-navy">ASI</span>
                  </div>
                  <p className="mt-2 text-xs font-sans uppercase tracking-[0.22em] text-asi-navy/65">
                    Оценка локации
                  </p>
                  <BrandHeadline as="h1" className="mt-8 text-4xl sm:text-5xl lg:text-[3.25rem]">
                    Понять потенциал объекта
                    <br />
                    <span className="text-asi-gold">до вложений.</span>
                  </BrandHeadline>
                  <BrandGoldRule className="mt-6 mb-6" />
                  <p className="text-lg text-asi-navy/70 max-w-xl leading-relaxed">
                    Проверьте адрес, получите общий вывод по спросу, окружению, конкуренции и
                    рискам, а затем переходите к подробному отчёту в личном кабинете.
                  </p>
                  <div className="mt-8">
                    <BrandPrimaryCta href="#location-check">Оценить объект по адресу</BrandPrimaryCta>
                  </div>
                </div>

                <aside className="border border-asi-border bg-asi-paper p-6 sm:p-8">
                  <p className="text-[10px] font-sans font-semibold uppercase tracking-[0.18em] text-asi-gold-text">
                    Что вы получите сначала
                  </p>
                  <h2 className="mt-3 font-serif text-2xl text-asi-navy leading-snug">
                    Общий отчёт помогает быстро понять потенциал объекта и принять первое решение
                    на данных.
                  </h2>
                  <p className="mt-4 text-sm text-asi-navy/65 leading-relaxed">
                    Это удобная первая проверка перед покупкой, запуском, сравнением объектов или
                    подключением управления. Доход не гарантируется.
                  </p>
                </aside>
              </div>
            </div>
          </section>

          <section id="location-check" className="scroll-mt-20">
            <LocationIntelligenceDemo locale="ru" initialMode={mode} edgeToHeader />
          </section>
        </main>

        <RuComplianceFooter tone="theme" />
      </LocationTelemetryProvider>
    </div>
  );
}
