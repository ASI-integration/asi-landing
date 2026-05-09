import Link from 'next/link';
import type { Metadata } from 'next';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';
import { RuBottomQuickLinks } from '@/components/ru/RuBottomQuickLinks';
import { RuComplianceFooter } from '@/components/ru/RuComplianceFooter';
import {
  PublicBadge,
  PublicInfoCard,
  PublicPrimaryCta,
  PublicSecondaryCta,
  PublicSection,
  PublicSectionHeader,
  PublicTextLink,
} from '@/components/public';
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
        <PublicSection variant="hero">
          <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[1.22fr_0.78fr] lg:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--t-muted)]">
                Коммерческий отчёт по доходности
              </p>
              <h1 className="mt-4 max-w-4xl text-4xl font-bold leading-tight tracking-tight text-[var(--t-text)] sm:text-5xl lg:text-6xl">
                Оцените потенциал дохода объекта по адресу
              </h1>
              <p className="mt-5 max-w-3xl text-lg leading-relaxed text-[var(--t-text-2)] sm:text-xl">
                Для собственников, операторов и инвесторов, которым нужно быстро понять, стоит ли идти глубже в объект.
                Экспресс-оценка показывает спрос, конкуренцию, сильные и слабые стороны локации, а полный отчёт помогает
                принять решение перед покупкой, арендой или запуском.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <PublicPrimaryCta href={EXPRESS_ASSESSMENT_HREF}>Запустить экспресс-оценку</PublicPrimaryCta>
                <PublicSecondaryCta
                  href={LOCATION_REPORT_SAMPLE_PATH}
                  className="sm:min-w-[min(100%,320px)] lg:min-w-[340px]"
                >
                  Посмотреть пример полного отчёта
                </PublicSecondaryCta>
              </div>
              <div className="mt-4">
                <PublicTextLink href={METHODOLOGY_HREF}>Как мы считаем</PublicTextLink>
              </div>
              <p className="mt-4 max-w-xl text-sm leading-relaxed text-[var(--t-muted)]">
                Следующий шаг простой: введите адрес и получите предварительный вывод без обещаний гарантированного дохода.
              </p>
            </div>

            <aside className="rounded-2xl border border-[var(--t-border)] bg-[var(--t-surface)] p-6 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--t-muted)]">
                Что получает клиент
              </p>
              <h2 className="mt-3 text-2xl font-bold leading-tight text-[var(--t-text)]">
                Понятный вывод до сделки или запуска
              </h2>
              <ul className="mt-5 space-y-4">
                {[
                  'Краткий вывод по потенциалу адреса',
                  'Факторы спроса и конкурентного давления',
                  'Риски, ограничения и качество данных',
                  'Следующие шаги для проверки объекта',
                ].map((label) => (
                  <li key={label} className="flex gap-3">
                    <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[var(--t-accent)]" />
                    <span className="pt-1 text-base font-semibold leading-snug text-[var(--t-text)]">{label}</span>
                  </li>
                ))}
              </ul>
              <PublicInfoCard className="mt-6 border-[var(--t-border)] bg-[var(--t-bg)] p-4">
                <p className="text-sm leading-relaxed text-[var(--t-muted)]">
                  Это не обещание дохода, а проверка адреса и факторов, которые стоит уточнить перед решением.
                </p>
              </PublicInfoCard>
            </aside>
          </div>
        </PublicSection>

        <PublicSection variant="muted">
          <div className="mx-auto max-w-6xl">
            <PublicSectionHeader
              title="Что покажет отчёт"
              description="Без сложной карты и условных схем: только блоки, которые помогают понять потенциал адреса."
            />
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {REPORT_SECTIONS.map((item) => (
                <PublicInfoCard key={item.title} className="p-5">
                  <h3 className="text-base font-bold text-[var(--t-text)]">{item.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-[var(--t-muted)]">{item.text}</p>
                </PublicInfoCard>
              ))}
            </div>
          </div>
        </PublicSection>

        <PublicSection variant="default">
          <div className="mx-auto max-w-6xl">
            <PublicSectionHeader title="Экспресс-оценка и полный отчёт решают разные задачи" />
            <div className="mt-8 grid gap-5 lg:grid-cols-2">
              <PublicInfoCard className="p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--t-muted)]">Быстрый старт</p>
                <h3 className="mt-3 text-xl font-bold text-[var(--t-text)]">Экспресс-оценка</h3>
                <p className="mt-3 text-base leading-relaxed text-[var(--t-text-2)]">
                  Нужна, чтобы быстро увидеть первичный потенциал адреса: общий индекс, ближайшие факторы спроса,
                  конкуренцию и понятный предварительный вывод.
                </p>
              </PublicInfoCard>
              <PublicInfoCard className="p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--t-muted)]">Для решения</p>
                <h3 className="mt-3 text-xl font-bold text-[var(--t-text)]">Полный отчёт</h3>
                <p className="mt-3 text-base leading-relaxed text-[var(--t-text-2)]">
                  Нужен, когда объект рассматривается всерьёз: краткий вывод, структура оценки, доходный диапазон,
                  ограничения, качество данных и следующие шаги для проверки.
                </p>
              </PublicInfoCard>
            </div>
          </div>
        </PublicSection>

        <PublicSection variant="muted">
          <div className="mx-auto max-w-6xl">
            <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
              <PublicSectionHeader
                title="Для каких объектов подходит"
                description="Отчёт полезен перед покупкой, арендой, запуском нового объекта или пересмотром стратегии уже работающей локации."
              />
              <div className="flex flex-wrap gap-2 sm:gap-3">
                {OBJECT_TYPES.map((label) => (
                  <PublicBadge key={label}>{label}</PublicBadge>
                ))}
              </div>
            </div>
          </div>
        </PublicSection>

        <PublicSection variant="default">
          <div className="mx-auto max-w-3xl text-center">
            <PublicSectionHeader
              align="center"
              titleClassName="text-3xl font-bold tracking-tight text-[var(--t-text)] sm:text-4xl"
              title="Проверьте адрес до того, как принимать решение"
              description={
                <p className="text-lg leading-relaxed text-[var(--t-text-2)]">
                  Начните с экспресс-оценки, а затем посмотрите, как выглядит полный отчёт для более глубокого разбора.
                </p>
              }
            />
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row sm:flex-wrap">
              <PublicPrimaryCta href={EXPRESS_ASSESSMENT_HREF}>Запустить экспресс-оценку</PublicPrimaryCta>
              <PublicSecondaryCta href={LOCATION_REPORT_SAMPLE_PATH} className="sm:min-w-[240px]">
                Пример отчёта
              </PublicSecondaryCta>
            </div>
            <div className="mt-5 flex justify-center">
              <PublicTextLink href={METHODOLOGY_HREF}>Методология</PublicTextLink>
            </div>
            <PublicInfoCard className="mt-8 border-[var(--t-border)] bg-[var(--t-surface-2)] text-left">
              <p className="text-sm leading-relaxed text-[var(--t-text-2)]">
                Расчёт не обещает гарантированный доход. Итог зависит от качества данных, состояния объекта, сезона,
                цены, каналов продаж и управления.
              </p>
            </PublicInfoCard>
          </div>
        </PublicSection>
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
