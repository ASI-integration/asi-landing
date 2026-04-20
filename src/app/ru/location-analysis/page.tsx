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
    'Введите адрес — ASI покажет спрос, конкуренцию, магниты трафика, структуру потока и форматный потенциал точки.',
};

export default async function RuLocationAnalysisPage(
  props: { searchParams: Promise<{ mode?: string }> },
) {
  const searchParams = await props.searchParams;
  const mode: LocationAnalysisMode =
    searchParams.mode === 'commercial' ? 'commercial' : 'residential';

  const isCommercial = mode === 'commercial';

  return (
    <ThemeProvider defaultTheme="midnight" className="min-h-screen bg-slate-950 text-white">
      <LocationTelemetryProvider>

        <RuPublicNavHeader surface="dark" density="landing" />

        <main>

          {/* ── Breadcrumb ── */}
          <div className="py-4 px-4 sm:px-6 border-b border-slate-800/40">
            <div className="max-w-3xl mx-auto flex items-center gap-2 text-xs text-slate-500">
              <Link href="/ru" className="hover:text-slate-300 transition-colors">ASI</Link>
              <span>/</span>
              <span className="text-slate-400">
                {isCommercial ? 'Коммерческий анализ' : 'Оценка доходности'}
              </span>
            </div>
          </div>

          {/* ── Bridge block ── */}
          <section className="py-10 sm:py-14 px-4 sm:px-6 border-b border-slate-800/60">
            <div className="max-w-3xl mx-auto">
              {isCommercial ? (
                <>
                  <h1 className="text-3xl sm:text-4xl font-bold text-white leading-tight mb-4">
                    Детальная пространственная карта локации
                  </h1>
                  <p className="text-slate-300 text-base leading-relaxed mb-6">
                    Пространственный анализ для коммерческой точки: не просто «хорошее место» —
                    а какой тип потока здесь формируется и какому формату это соответствует.
                  </p>
                  <ul className="space-y-2.5">
                    {[
                      'Структура потока: транзит, локальная активность, целевые визиты',
                      'Форматная матрица: какой бизнес-формат подходит по данным локации',
                      'Якоря, барьеры и конкурентный контекст',
                    ].map((point) => (
                      <li key={point} className="flex items-start gap-3 text-sm text-slate-300">
                        <span className="mt-1 w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
                        {point}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-6 text-xs text-slate-500 border-l-2 border-slate-700 pl-3">
                    Это предварительный интеллектуальный анализ на основе открытых пространственных данных.
                    Не заменяет физический осмотр, но помогает принять обоснованное решение до визита.
                  </p>
                </>
              ) : (
                <>
                  <h1 className="text-3xl sm:text-4xl font-bold text-white leading-tight mb-4">
                    Доходность начинается с локации
                  </h1>
                  <p className="text-slate-300 text-base leading-relaxed mb-7">
                    Один и тот же объект даёт разный результат в зависимости от того, где он стоит и кто реально
                    ищет аренду в этом районе. Локация определяет не только цену, но и тип спроса. Без этого
                    понимания легко ошибиться с позиционированием — ещё до запуска.
                  </p>
                  <p className="text-slate-500 text-sm leading-relaxed mb-7 border-l-2 border-slate-700 pl-4">
                    Это не теория. Собственник вложил около 2 млн рублей в объект под Краснодаром, рассчитывая на спрос «по ощущениям». Без понимания локации и целевой аудитории объект уже больше года не удаётся ни нормально сдать, ни продать.
                  </p>
                  <ul className="space-y-2.5">
                    {[
                      'Кому реально подходит объект — и кто будет его снимать',
                      'На какой спрос он может опираться — посуточный, деловой, среднесрочный',
                      'Какую доходность можно ожидать до запуска — по данным, а не по ощущениям',
                    ].map((point) => (
                      <li key={point} className="flex items-start gap-3 text-sm text-slate-300">
                        <span className="mt-1 w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                        {point}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </section>

          {/* ── Calculator / demo ── */}
          <LocationIntelligenceDemo locale="ru" initialMode={mode} />

        </main>

        <RuComplianceFooter />

      </LocationTelemetryProvider>
    </ThemeProvider>
  );
}
