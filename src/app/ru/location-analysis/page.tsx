import type { Metadata } from 'next';
import Link from 'next/link';
import { LocationIntelligenceDemo } from '@/components/LocationIntelligenceDemo';
import { LocationTelemetryProvider } from '@/context/landing-location-telemetry';
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';
import { RuComplianceFooter } from '@/components/ru/RuComplianceFooter';
import { ThemeProvider } from '@/theme/ThemeProvider';

export const metadata: Metadata = {
  title: 'Оценка доходности объекта — ASI',
  description:
    'Введите адрес — ASI покажет спрос, конкуренцию, магниты трафика и ожидаемый доход. Подходит для инвесторов, управляющих и собственников.',
};

export default function RuLocationAnalysisPage() {
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
              <span className="text-slate-400">Оценка доходности</span>
            </div>
          </div>

          {/* ── Bridge block ── */}
          <section className="py-10 sm:py-14 px-4 sm:px-6 border-b border-slate-800/60">
            <div className="max-w-3xl mx-auto">
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
            </div>
          </section>

          {/* ── Calculator / demo ── */}
          <LocationIntelligenceDemo locale="ru" />

        </main>

        <RuComplianceFooter />

      </LocationTelemetryProvider>
    </ThemeProvider>
  );
}
