import Link from 'next/link';
import type { Metadata } from 'next';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';
import { RuBottomQuickLinks } from '@/components/ru/RuBottomQuickLinks';
import { RuComplianceFooter } from '@/components/ru/RuComplianceFooter';
import { LOCATION_REPORT_SAMPLE_PATH } from '@/lib/location/report-state';

export const metadata: Metadata = {
  title: 'Отчёт по доходности объекта по адресу — ASI',
  description:
    'Экспресс-оценка и полный отчёт по потенциалу дохода объекта: спрос, конкуренция, сильные стороны, риски и рекомендации.',
};

const EXPRESS_ASSESSMENT_HREF = '/ru/location-analysis?mode=residential';
const METHODOLOGY_HREF = '/ru/kak-my-ocenivaem-dohodnost-obektov';

const REPORT_SECTIONS = [
  {
    title: 'Спрос',
    text: 'Какие сигналы рядом с адресом поддерживают краткосрочную или среднесрочную аренду.',
  },
  {
    title: 'Конкуренция',
    text: 'Насколько плотно окружение занято похожими объектами и что это значит для цены.',
  },
  {
    title: 'Магниты рядом',
    text: 'Транспорт, деловые зоны, учебные и городские точки, которые могут создавать поток гостей.',
  },
  {
    title: 'Риски',
    text: 'Что может снизить результат: слабые данные, неподходящий формат, сезонность или давление конкурентов.',
  },
  {
    title: 'Рекомендации',
    text: 'Какой сценарий стоит проверять дальше: посуточный, среднесрочный или смешанный.',
  },
] as const;

const OBJECT_TYPES = [
  'квартиры',
  'апартаменты',
  'мини-отели',
  'апарт-отели',
  'портфели из нескольких объектов',
] as const;

export default function OtchetPoDohodnostiPage() {
  return (
    <ThemeProvider defaultTheme="light" className="theme-transition min-h-screen bg-[var(--t-bg)] text-[var(--t-text)]">
      <RuPublicNavHeader surface="theme" density="landing" />

      <main>
        <section className="px-4 py-16 sm:px-6 sm:py-20 lg:py-24 bg-[var(--t-bg)]">
          <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--t-muted)]">
                Отчёт по локации
              </p>
              <h1 className="mt-4 max-w-3xl text-4xl font-bold leading-tight tracking-tight text-[var(--t-text)] sm:text-5xl">
                Оцените потенциал дохода объекта по адресу
              </h1>
              <p className="mt-5 max-w-2xl text-lg leading-relaxed text-[var(--t-text-2)] sm:text-xl">
                Экспресс-оценка показывает спрос, конкуренцию, сильные и слабые стороны локации. Полный отчёт помогает
                принять решение перед покупкой, арендой или запуском объекта.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href={EXPRESS_ASSESSMENT_HREF}
                  className="inline-flex w-full shrink-0 items-center justify-center rounded-xl bg-[var(--t-accent)] px-8 py-4 text-base font-bold text-white shadow-lg transition-all hover:scale-[1.02] hover:bg-[var(--t-accent-hover)] sm:w-auto sm:whitespace-nowrap"
                >
                  Запустить экспресс-оценку
                </Link>
                <Link
                  href={LOCATION_REPORT_SAMPLE_PATH}
                  className="inline-flex w-full shrink-0 items-center justify-center rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] px-8 py-4 text-base font-semibold text-[var(--t-text-2)] transition-all hover:bg-[var(--t-surface-2)] sm:w-auto sm:whitespace-nowrap"
                >
                  Посмотреть пример полного отчёта
                </Link>
              </div>
              <p className="mt-4 max-w-xl text-sm leading-relaxed text-[var(--t-muted)]">
                Следующий шаг простой: введите адрес, получите предварительный вывод и откройте пример структуры полного отчёта.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ['1', 'Адрес объекта'],
                ['2', 'Экспресс-оценка'],
                ['3', 'Пример полного отчёта'],
                ['4', 'Решение по объекту'],
              ].map(([step, label]) => (
                <div key={step} className="rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--t-muted)]">Шаг {step}</p>
                  <p className="mt-3 text-lg font-semibold leading-snug text-[var(--t-text)]">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-[var(--t-border)] bg-[var(--t-surface-2)] px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-6xl">
            <div className="max-w-3xl">
              <h2 className="text-2xl font-bold tracking-tight text-[var(--t-text)] sm:text-3xl">
                Что покажет отчёт
              </h2>
              <p className="mt-3 text-base leading-relaxed text-[var(--t-text-2)]">
                Без сложной карты и условных схем: только блоки, которые помогают понять потенциал адреса.
              </p>
            </div>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {REPORT_SECTIONS.map(item => (
                <div key={item.title} className="rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] p-5">
                  <h3 className="text-base font-bold text-[var(--t-text)]">{item.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-[var(--t-muted)]">{item.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-t border-[var(--t-border)] bg-[var(--t-bg)] px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-6xl">
            <h2 className="max-w-3xl text-2xl font-bold tracking-tight text-[var(--t-text)] sm:text-3xl">
              Экспресс-оценка и полный отчёт решают разные задачи
            </h2>
            <div className="mt-8 grid gap-5 lg:grid-cols-2">
              <div className="rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--t-muted)]">Быстрый старт</p>
                <h3 className="mt-3 text-xl font-bold text-[var(--t-text)]">Экспресс-оценка</h3>
                <p className="mt-3 text-base leading-relaxed text-[var(--t-text-2)]">
                  Нужна, чтобы быстро увидеть первичный потенциал адреса: общий индекс, ближайшие факторы спроса,
                  конкуренцию и понятный предварительный вывод.
                </p>
              </div>
              <div className="rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--t-muted)]">Для решения</p>
                <h3 className="mt-3 text-xl font-bold text-[var(--t-text)]">Полный отчёт</h3>
                <p className="mt-3 text-base leading-relaxed text-[var(--t-text-2)]">
                  Нужен, когда объект рассматривается всерьёз: краткий вывод, структура оценки, доходный диапазон,
                  ограничения, качество данных и следующие шаги для проверки.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="border-t border-[var(--t-border)] bg-[var(--t-surface-2)] px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-6xl">
            <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-[var(--t-text)] sm:text-3xl">
                  Для каких объектов подходит
                </h2>
                <p className="mt-3 text-base leading-relaxed text-[var(--t-text-2)]">
                  Отчёт полезен перед покупкой, арендой, запуском нового объекта или пересмотром стратегии уже работающей локации.
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                {OBJECT_TYPES.map(label => (
                  <span
                    key={label}
                    className="inline-flex items-center rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] px-4 py-3 text-sm font-semibold text-[var(--t-text-2)]"
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="border-t border-[var(--t-border)] bg-[var(--t-bg)] px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-[var(--t-text)] sm:text-4xl">
              Проверьте адрес до того, как принимать решение
            </h2>
            <p className="mt-4 text-lg leading-relaxed text-[var(--t-text-2)]">
              Начните с экспресс-оценки, а затем посмотрите, как выглядит полный отчёт для более глубокого разбора.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href={EXPRESS_ASSESSMENT_HREF}
                className="inline-flex w-full shrink-0 items-center justify-center rounded-xl bg-[var(--t-accent)] px-8 py-4 text-base font-bold text-white shadow-lg transition-all hover:scale-[1.02] hover:bg-[var(--t-accent-hover)] sm:w-auto sm:whitespace-nowrap"
              >
                Запустить экспресс-оценку
              </Link>
              <Link
                href={LOCATION_REPORT_SAMPLE_PATH}
                className="inline-flex w-full shrink-0 items-center justify-center rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] px-8 py-4 text-base font-semibold text-[var(--t-text-2)] transition-all hover:bg-[var(--t-surface-2)] sm:w-auto sm:whitespace-nowrap"
              >
                Пример отчёта
              </Link>
              <Link
                href={METHODOLOGY_HREF}
                className="inline-flex w-full shrink-0 items-center justify-center rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] px-8 py-4 text-base font-semibold text-[var(--t-text-2)] transition-all hover:bg-[var(--t-surface-2)] sm:w-auto sm:whitespace-nowrap"
              >
                Методология
              </Link>
            </div>
            <div className="mt-8 rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] p-5 text-left">
              <p className="text-sm leading-relaxed text-[var(--t-text-2)]">
                Расчёт не обещает гарантированный доход. Итог зависит от качества данных, состояния объекта, сезона,
                цены, каналов продаж и управления.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer>
        <RuBottomQuickLinks tone="theme" />
        <div className="border-t border-[var(--t-border)] bg-[var(--t-bg)] px-4 py-6 sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <Link href="/" className="text-lg font-bold text-[var(--t-text)] transition-opacity hover:opacity-80">
                ASI
              </Link>
              <span className="text-xs text-[var(--t-muted)]">© {new Date().getFullYear()}</span>
            </div>
          </div>
        </div>
        <RuComplianceFooter tone="theme" />
      </footer>
    </ThemeProvider>
  );
}
