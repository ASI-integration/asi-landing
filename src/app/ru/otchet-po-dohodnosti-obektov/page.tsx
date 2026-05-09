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
    'Проверка потенциала дохода по адресу до покупки, аренды или запуска: спрос рядом, конкуренция, сильные стороны, риски и что уточнить перед решением.',
};

const EXPRESS_ASSESSMENT_HREF = '/ru/location-analysis?mode=residential';
const METHODOLOGY_HREF = '/ru/kak-my-ocenivaem-dohodnost-obektov';

const REPORT_BLOCKS = [
  {
    title: 'Потенциал дохода',
    text: 'Насколько адрес в целом выглядит перспективным для аренды с точки зрения доступных сигналов по локации.',
  },
  {
    title: 'Спрос рядом',
    text: 'Что реально может тянуть гостей к этому месту: события, транспорт, работа, учёба, отдых.',
  },
  {
    title: 'Конкуренция',
    text: 'Насколько плотно вокруг предложение похожих объектов и что это значит для загрузки и цены.',
  },
  {
    title: 'Магниты и инфраструктура',
    text: 'Точки рядом, которые усиливают или ослабляют интерес к адресу.',
  },
  {
    title: 'Риски и рекомендации',
    text: 'Что может сорвать ожидания по доходу и какие вопросы закрыть до договора или запуска.',
  },
] as const;

const WHY_CARDS = [
  {
    title: 'Не купить слабый объект',
    text: 'Увидеть до сделки, есть ли у адреса опора на спрос или это ставка вслепую.',
  },
  {
    title: 'Не переплатить за аренду',
    text: 'Сопоставить условия локации с тем, какую аренду реально «держит» рынок рядом.',
  },
  {
    title: 'Понять спрос до запуска',
    text: 'Решить, есть ли смысл вкладываться в посуточную или среднесрок именно здесь.',
  },
  {
    title: 'Увидеть риски заранее',
    text: 'Не удивиться сезонностью, давлением конкурентов или «дырами» в понимании объекта.',
  },
] as const;

const DECISION_ITEMS = [
  'Брать объект в работу или отказаться.',
  'Запускать посуточную аренду здесь или искать другую локацию.',
  'Какой аудитории логичнее продавать объект.',
  'Достаточно ли экспресс-оценки или нужен полный разбор.',
  'Какие данные запросить у собственника или управляющего до подписания.',
] as const;

const EXPRESS_POINTS = [
  'Быстрый предварительный вывод.',
  'Видно, есть ли смысл копать глубже.',
  'Подходит для первичного отбора.',
] as const;

const FULL_REPORT_POINTS = [
  'Подробный разбор локации.',
  'Драйверы спроса.',
  'Конкуренция.',
  'Аудитория.',
  'Риски.',
  'Рекомендации по стратегии.',
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
                Проверьте потенциал дохода объекта до покупки, аренды или запуска
              </p>
              <h1 className="mt-4 max-w-4xl text-4xl font-bold leading-tight tracking-tight text-[var(--t-text)] sm:text-5xl lg:text-6xl">
                Проверить объект до покупки, аренды или запуска
              </h1>
              <p className="mt-5 max-w-3xl text-lg leading-relaxed text-[var(--t-text-2)] sm:text-xl">
                Экспресс-оценка показывает, есть ли у адреса потенциал дохода: спрос рядом, конкуренция, сильные и слабые
                стороны локации. Полный отчёт помогает решить, стоит ли брать объект в работу или проверять глубже.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <PublicPrimaryCta href={EXPRESS_ASSESSMENT_HREF}>Проверить адрес</PublicPrimaryCta>
                <PublicSecondaryCta
                  href={LOCATION_REPORT_SAMPLE_PATH}
                  className="sm:min-w-[min(100%,320px)] lg:min-w-[340px]"
                >
                  Посмотреть пример отчёта
                </PublicSecondaryCta>
              </div>
              <div className="mt-4">
                <PublicTextLink href={METHODOLOGY_HREF}>Как мы считаем</PublicTextLink>
              </div>
              <p className="mt-4 max-w-xl text-sm leading-relaxed text-[var(--t-muted)]">
                Без обещаний гарантированного дохода. Расчёт показывает риски и потенциал по доступным данным.
              </p>
            </div>

            <aside className="rounded-2xl border border-[var(--t-border)] bg-[var(--t-surface)] p-6 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--t-muted)]">
                Что выясняете до траты денег
              </p>
              <h2 className="mt-3 text-2xl font-bold leading-tight text-[var(--t-text)]">
                Стоит ли вообще рассматривать этот объект
              </h2>
              <ul className="mt-5 space-y-4">
                {[
                  'Есть ли рядом реальные драйверы спроса.',
                  'Насколько сильная конкуренция.',
                  'Какая аудитория вероятнее всего будет бронировать.',
                  'Какие риски видны заранее и что проверить перед решением.',
                  'Когда достаточно экспресс-оценки, а когда нужен полный отчёт.',
                ].map((label) => (
                  <li key={label} className="flex gap-3">
                    <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[var(--t-accent)]" />
                    <span className="pt-1 text-base font-semibold leading-snug text-[var(--t-text)]">{label}</span>
                  </li>
                ))}
              </ul>
              <PublicInfoCard className="mt-6 border-[var(--t-border)] bg-[var(--t-bg)] p-4">
                <p className="text-sm leading-relaxed text-[var(--t-muted)]">
                  Это поддержка решения, а не прогноз прибыли: видно, куда смотреть внимательнее и что уточнить по объекту.
                </p>
              </PublicInfoCard>
            </aside>
          </div>
        </PublicSection>

        <PublicSection variant="muted">
          <div className="mx-auto max-w-6xl">
            <PublicSectionHeader
              title="Зачем нужен отчёт"
              description="Снижаете риск ошибиться до покупки, аренды или запуска и тратите бюджет осознаннее."
            />
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {WHY_CARDS.map((card) => (
                <PublicInfoCard key={card.title} className="p-5">
                  <h3 className="text-base font-bold text-[var(--t-text)]">{card.title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-[var(--t-muted)]">{card.text}</p>
                </PublicInfoCard>
              ))}
            </div>
          </div>
        </PublicSection>

        <PublicSection variant="default">
          <div className="mx-auto max-w-6xl">
            <PublicSectionHeader
              title="Какие решения помогает принять"
              description="Ответы привязаны к адресу и рынку рядом, без лишней аналитики ради отчёта."
            />
            <PublicInfoCard className="mt-8 p-6">
              <ul className="space-y-4">
                {DECISION_ITEMS.map((item) => (
                  <li key={item} className="flex gap-3 text-base leading-relaxed text-[var(--t-text-2)]">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--t-accent)]" aria-hidden />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </PublicInfoCard>
          </div>
        </PublicSection>

        <PublicSection variant="muted">
          <div className="mx-auto max-w-6xl">
            <PublicSectionHeader
              title="Что показывает отчёт"
              description="Пять блоков, которые переводят локацию на язык решения: брать объект или нет, и что проверить дальше."
            />
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {REPORT_BLOCKS.map((item) => (
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
            <PublicSectionHeader title="Экспресс-оценка и полный отчёт" />
            <div className="mt-8 grid gap-5 lg:grid-cols-2">
              <PublicInfoCard className="p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--t-muted)]">Экспресс-оценка</p>
                <ul className="mt-5 space-y-3 text-base leading-relaxed text-[var(--t-text-2)]">
                  {EXPRESS_POINTS.map((point) => (
                    <li key={point} className="flex gap-3">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--t-accent)]" aria-hidden />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </PublicInfoCard>
              <PublicInfoCard className="p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--t-muted)]">Полный отчёт</p>
                <ul className="mt-5 space-y-3 text-base leading-relaxed text-[var(--t-text-2)]">
                  {FULL_REPORT_POINTS.map((point) => (
                    <li key={point} className="flex gap-3">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--t-accent)]" aria-hidden />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </PublicInfoCard>
            </div>
          </div>
        </PublicSection>

        <PublicSection variant="muted">
          <div className="mx-auto max-w-6xl">
            <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
              <PublicSectionHeader
                title="Для каких объектов подходит"
                description="Перед покупкой, арендой, запуском нового объекта или пересмотром стратегии уже работающей локации."
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
              title="Проверьте адрес перед решением"
              description={
                <p className="text-lg leading-relaxed text-[var(--t-text-2)]">
                  Начните с проверки адреса — затем откройте пример полного отчёта, если объект проходит первый отбор.
                </p>
              }
            />
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row sm:flex-wrap">
              <PublicPrimaryCta href={EXPRESS_ASSESSMENT_HREF}>Проверить адрес</PublicPrimaryCta>
              <PublicSecondaryCta href={LOCATION_REPORT_SAMPLE_PATH} className="sm:min-w-[240px]">
                Посмотреть пример отчёта
              </PublicSecondaryCta>
            </div>
            <div className="mt-5 flex justify-center">
              <PublicTextLink href={METHODOLOGY_HREF}>Как мы считаем</PublicTextLink>
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
