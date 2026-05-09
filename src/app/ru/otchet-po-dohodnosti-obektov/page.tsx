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
} from '@/components/public';
import { LOCATION_REPORT_SAMPLE_PATH } from '@/lib/location/report-state';

export const metadata: Metadata = {
  title: 'Отчёт по доходности объекта по адресу — ASI',
  description:
    'Проверка потенциала дохода по адресу до покупки, аренды или запуска: спрос рядом, конкуренция, сильные стороны, риски и что уточнить перед решением.',
};

const EXPRESS_ASSESSMENT_HREF = '/ru/location-analysis?mode=residential';
const METHODOLOGY_HREF = '/ru/kak-my-ocenivaem-dohodnost-obektov';

const methodologyLinkClassName =
  'text-base font-normal text-[var(--t-text-2)] underline-offset-4 transition-colors hover:text-[var(--t-text)] hover:underline focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--t-accent)]';

const REPORT_BLOCKS = [
  {
    title: 'Потенциал дохода',
    text: 'Реалистичный прогноз выручки и понимание ценового потолка для этой локации.',
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
    text: 'Точки притяжения вокруг, которые будут генерировать вам стабильный поток гостей.',
  },
  {
    title: 'Риски и рекомендации',
    text: 'Факторы, способные убить доходность, и пошаговый план проверок до сделки.',
  },
] as const;

const WHY_CARDS = [
  {
    title: 'Не купить слабый объект',
    text: 'Узнать до сделки, есть ли здесь реальный спрос, или это инвестиция вслепую.',
  },
  {
    title: 'Не переплатить за аренду',
    text: 'Понять, соответствует ли запрашиваемая цена реальным арендным ставкам в этом районе.',
  },
  {
    title: 'Понять спрос до запуска',
    text: 'Определить, какая модель принесет больше денег именно здесь: посуточная или среднесрочная аренда.',
  },
  {
    title: 'Увидеть риски заранее',
    text: 'Заранее выявить скрытую сезонность, жесткую конкуренцию и другие подводные камни локации.',
  },
] as const;

const COMPARISON_CARDS = [
  {
    title: 'Экспресс-оценка',
    text: 'Быстрый срез данных для первичного фильтра: сразу показывает базовый потенциал локации и уровень конкуренции, чтобы отсеять заведомо слабые варианты.',
  },
  {
    title: 'Полный отчёт',
    text: 'Глубокая аналитика для финализации сделки. Детальный расчёт спроса, портрет вашей будущей аудитории, скрытые магниты инфраструктуры и конкретные рекомендации по стратегии запуска.',
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
                ОТЧЁТ ПО ЛОКАЦИИ
              </p>
              <h1 className="mt-4 max-w-4xl text-4xl font-bold leading-tight tracking-tight text-[var(--t-text)] sm:text-5xl lg:text-6xl">
                Оцените реальную доходность недвижимости по одному адресу
              </h1>
              <p className="mt-5 max-w-3xl text-lg leading-relaxed text-[var(--t-text-2)] sm:text-xl">
                Для собственников, инвесторов и управляющих компаний. Узнайте заранее, стоит ли вкладывать время и
                деньги в конкретную локацию. Наш экспресс-анализ моментально покажет уровень спроса и плотность
                конкурентов, а подробный отчёт убережёт от финансовых ошибок перед покупкой, арендой или запуском
                объекта.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                <PublicPrimaryCta href={EXPRESS_ASSESSMENT_HREF}>Запустить экспресс-оценку</PublicPrimaryCta>
                <PublicSecondaryCta
                  href={LOCATION_REPORT_SAMPLE_PATH}
                  className="sm:min-w-[min(100%,320px)] lg:min-w-[340px]"
                >
                  Посмотреть пример отчёта
                </PublicSecondaryCta>
              </div>
              <p className="mt-4 max-w-2xl text-base leading-relaxed text-[var(--t-muted)]">
                Введите адрес и получите предварительный вывод по локации. Полный отчёт помогает оценить коммерческий
                потенциал объекта до того, как рисковать бюджетом.
              </p>
              <p className="mt-4">
                <Link href={METHODOLOGY_HREF} className={methodologyLinkClassName}>
                  Как считается оценка →
                </Link>
              </p>
            </div>

            <aside className="rounded-2xl border border-[var(--t-border)] bg-[var(--t-surface)] p-6 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--t-muted)]">
                ЧТО ВНУТРИ ОТЧЁТА
              </p>
              <h2 className="mt-3 text-2xl font-bold leading-tight text-[var(--t-text)]">
                Твёрдые данные для принятия решения до сделки
              </h2>
              <ul className="mt-5 space-y-4">
                {[
                  'Оценка ликвидности: чёткий вердикт — высокий потенциал или пустая трата денег.',
                  'Карта спроса: кто ваши соседи по бизнесу и откуда придут клиенты.',
                  'Скрытые угрозы: неочевидные риски локации и ограничения.',
                  'Пошаговый план: что нужно проверить до подписания договора.',
                ].map((label) => (
                  <li key={label} className="flex gap-3">
                    <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[var(--t-accent)]" />
                    <span className="pt-1 text-base leading-relaxed text-[var(--t-text)]">{label}</span>
                  </li>
                ))}
              </ul>
              <PublicInfoCard className="mt-6 border-[var(--t-border)] bg-[var(--t-bg)] p-4">
                <p className="text-sm leading-relaxed text-[var(--t-muted)]">
                  Объективный анализ на основе реальных рыночных данных. Мы не обещаем золотые горы. Мы даём сухие цифры
                  и статистику, чтобы вы избежали убытков и увидели настоящий потенциал объекта.
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
              {COMPARISON_CARDS.map((card) => (
                <PublicInfoCard key={card.title} className="p-6">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--t-muted)]">
                    {card.title}
                  </p>
                  <p className="mt-5 text-base leading-relaxed text-[var(--t-text-2)]">{card.text}</p>
                </PublicInfoCard>
              ))}
            </div>
          </div>
        </PublicSection>

        <PublicSection variant="muted">
          <div className="mx-auto max-w-6xl">
            <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
              <PublicSectionHeader
                title="Для каких объектов подходит"
                description="Помогает оценить рентабельность перед покупкой, арендой или запуском нового объекта, а также найти точки роста для уже работающей локации."
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
              title="Сделайте первый шаг к безопасной сделке"
              description={
                <p className="text-lg leading-relaxed text-[var(--t-text-2)]">
                  Запустите экспресс-оценку потенциала локации. Если базовые показатели вас устроят — откройте пример
                  полного отчёта, чтобы увидеть всю глубину аналитики.
                </p>
              }
            />
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row sm:flex-wrap">
              <PublicPrimaryCta href={EXPRESS_ASSESSMENT_HREF}>Запустить экспресс-оценку</PublicPrimaryCta>
              <PublicSecondaryCta href={LOCATION_REPORT_SAMPLE_PATH} className="sm:min-w-[240px]">
                Посмотреть пример отчёта
              </PublicSecondaryCta>
            </div>
            <PublicInfoCard className="mx-auto mt-10 max-w-2xl border-[var(--t-border)] bg-[var(--t-surface-2)] text-left">
              <p className="text-base leading-relaxed text-[var(--t-muted)]">
                Расчёт не обещает гарантированный доход. Итог зависит от качества данных, состояния объекта, сезона,
                цены, каналов продаж и управления.
              </p>
            </PublicInfoCard>
            <p className="mt-5 text-center">
              <Link href={METHODOLOGY_HREF} className={methodologyLinkClassName}>
                Как считается оценка →
              </Link>
            </p>
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
