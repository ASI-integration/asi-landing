import type { Metadata } from 'next';
import Link from 'next/link';
import { LocationIntelligenceDemo } from '@/components/LocationIntelligenceDemo';
import type { LocationAnalysisMode } from '@/components/LocationIntelligenceDemo';
import { LocationTelemetryProvider } from '@/context/landing-location-telemetry';
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';
import { RuComplianceFooter } from '@/components/ru/RuComplianceFooter';
import { ThemeProvider } from '@/theme/ThemeProvider';
import {
  PublicInfoCard,
  PublicPrimaryCta,
  PublicSection,
  PublicSectionHeader,
} from '@/components/public';

export const metadata: Metadata = {
  title: 'Оценка локации — ASI',
  description:
    'Введите адрес и получите общий вывод по потенциалу объекта. Подробный отчёт доступен в личном кабинете ASI.',
};

const DASHBOARD_LOGIN_HREF = '/login';
const REPORT_PRODUCT_HREF = '/ru/otchet-po-dohodnosti-obektov';

const GENERAL_REPORT_ITEMS = [
  'Первичная оценка потенциала объекта.',
  'Сигналы спроса вокруг адреса.',
  'Карта магнитов и окружения.',
  'Конкуренты рядом.',
  'Ориентир по доходу как оценка, не гарантия.',
  'Риски, которые стоит проверить вручную.',
  'Рекомендация по сценарию: посуточная аренда, среднесрок, управление, сравнение объектов.',
  'Понятный вывод до покупки, запуска или подключения управления.',
] as const;

const DETAILED_REPORT_ITEMS = [
  'Полный разбор локации.',
  'Аудитория спроса: командированные, туристы, семьи, медтуризм, смешанный спрос.',
  'Транспортные, медицинские, учебные, туристические и деловые сигналы.',
  'Территориальный разбор окружения.',
  'Конкуренция и OTA-зависимость.',
  'Стратегия монетизации.',
  'Сценарии доходности диапазонами, без гарантий.',
  'Риски и ручные проверки.',
  'Рекомендации по упаковке объекта.',
  'Следующий шаг: запуск, сравнение, управление или доработка стратегии.',
  'Ссылка на сохранённый отчёт в личном кабинете.',
] as const;

export default async function RuLocationAnalysisPage(
  props: { searchParams: Promise<{ mode?: string }> },
) {
  const searchParams = await props.searchParams;
  const mode: LocationAnalysisMode =
    searchParams.mode === 'commercial' ? 'commercial' : 'residential';

  return (
    <ThemeProvider defaultTheme="light" className="theme-transition min-h-screen bg-[var(--t-bg)] text-[var(--t-text)]">
      <LocationTelemetryProvider>

        <RuPublicNavHeader surface="theme" density="landing" />

        <main>
          <PublicSection variant="hero">
            <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[1.12fr_0.88fr] lg:items-center">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--t-muted)]">
                  Оценка локации
                </p>
                <h1 className="mt-4 max-w-4xl text-4xl font-bold leading-tight tracking-tight text-[var(--t-text)] sm:text-5xl lg:text-6xl">
                  Понять потенциал объекта до вложений
                </h1>
                <p className="mt-5 max-w-3xl text-lg leading-relaxed text-[var(--t-text-2)] sm:text-xl">
                  Проверьте адрес, получите общий вывод по спросу, окружению, конкуренции и рискам, а затем переходите к подробному отчёту в личном кабинете.
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                  <PublicPrimaryCta href="#location-check">Проверить объект по адресу</PublicPrimaryCta>
                  <Link
                    href={DASHBOARD_LOGIN_HREF}
                    className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-[var(--t-border)] px-5 py-3 text-base font-semibold text-[var(--t-text)] transition-colors hover:bg-[var(--t-surface-2)]"
                  >
                    Перейти к подробному отчёту
                  </Link>
                </div>
              </div>

              <PublicInfoCard className="p-6 sm:p-7">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--t-muted)]">
                  Что вы получите сначала
                </p>
                <h2 className="mt-3 text-2xl font-bold text-[var(--t-text)]">
                  Общий отчёт помогает быстро понять потенциал объекта и принять первое решение на данных.
                </h2>
                <p className="mt-4 text-base leading-relaxed text-[var(--t-text-2)]">
                  Это удобная первая проверка перед покупкой, запуском, сравнением объектов или подключением управления.
                </p>
              </PublicInfoCard>
            </div>
          </PublicSection>

          <PublicSection variant="muted">
            <div className="mx-auto max-w-6xl">
              <PublicSectionHeader
                title="Общий и подробный отчёт"
                description="Публичная страница объясняет ценность проверки. Подробный формат открывается через личный кабинет."
              />
              <div className="mt-8 grid gap-6 lg:grid-cols-2">
                <PublicInfoCard className="p-6">
                  <h2 className="text-2xl font-bold text-[var(--t-text)]">Что входит в общий отчёт</h2>
                  <p className="mt-4 text-base leading-relaxed text-[var(--t-text-2)]">
                    Общий отчёт помогает быстро понять потенциал объекта и принять первое решение на данных.
                  </p>
                  <ul className="mt-6 grid gap-3">
                    {GENERAL_REPORT_ITEMS.map((item) => (
                      <li key={item} className="flex gap-3 text-sm leading-relaxed text-[var(--t-muted)]">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--t-accent)]" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </PublicInfoCard>

                <PublicInfoCard className="p-6">
                  <h2 className="text-2xl font-bold text-[var(--t-text)]">Что входит в подробный отчёт</h2>
                  <p className="mt-4 text-base leading-relaxed text-[var(--t-text-2)]">
                    Подробный отчёт доступен в личном кабинете и сохраняется как отдельная страница, чтобы его можно было открыть повторно или отправить партнёру.
                  </p>
                  <ul className="mt-6 grid gap-3">
                    {DETAILED_REPORT_ITEMS.map((item) => (
                      <li key={item} className="flex gap-3 text-sm leading-relaxed text-[var(--t-muted)]">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--t-accent)]" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                    <Link
                      href={DASHBOARD_LOGIN_HREF}
                      className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-[var(--t-accent)] px-5 py-3 text-base font-bold text-white transition-colors hover:bg-[var(--t-accent-hover)]"
                    >
                      Открыть личный кабинет
                    </Link>
                    <Link
                      href={DASHBOARD_LOGIN_HREF}
                      className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-[var(--t-border)] px-5 py-3 text-base font-bold text-[var(--t-text)] transition-colors hover:bg-[var(--t-surface-2)]"
                    >
                      Запросить подробный отчёт
                    </Link>
                  </div>
                </PublicInfoCard>
              </div>
            </div>
          </PublicSection>

          <section id="location-check" className="scroll-mt-20">
            <LocationIntelligenceDemo locale="ru" initialMode={mode} edgeToHeader />
          </section>

          <section
            aria-labelledby="location-analysis-connect-heading"
            className="border-t border-[var(--t-border)] bg-[var(--t-bg)] px-4 py-14 sm:px-6 sm:py-20"
          >
            <div className="mx-auto max-w-3xl text-center">
              <h2
                id="location-analysis-connect-heading"
                className="text-2xl font-bold tracking-tight text-[var(--t-text)] sm:text-3xl"
              >
                Хотите понять, как использовать эту локацию?
              </h2>
              <p className="mt-4 text-base leading-relaxed text-[var(--t-text-2)] sm:text-lg">
                Мы можем разобрать объект глубже: спрос, гостей, риски, цену, конкурентов и стратегию запуска. Это помогает
                выбрать сценарий монетизации до покупки, запуска посуточной аренды или подключения управления.
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row sm:flex-wrap">
                <Link
                  href={REPORT_PRODUCT_HREF}
                  className="inline-flex min-w-[min(100%,260px)] items-center justify-center rounded-xl border border-[var(--t-border)] px-6 py-4 text-base font-bold text-[var(--t-text)] transition-colors hover:bg-[var(--t-surface-2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--t-bg)]"
                >
                  Получить общий вывод
                </Link>
                <Link
                  href={DASHBOARD_LOGIN_HREF}
                  className="inline-flex min-w-[min(100%,280px)] items-center justify-center rounded-xl bg-[var(--t-accent)] px-8 py-4 text-base font-bold text-white shadow-lg transition-colors hover:bg-[var(--t-accent-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--t-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--t-bg)]"
                >
                  Перейти к подробному отчёту
                </Link>
              </div>
            </div>
          </section>
        </main>

        <RuComplianceFooter tone="theme" />

      </LocationTelemetryProvider>
    </ThemeProvider>
  );
}
