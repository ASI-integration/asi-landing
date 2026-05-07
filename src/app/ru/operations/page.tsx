import type { Metadata } from 'next';
import Link from 'next/link';
import { RuBottomQuickLinks } from '@/components/ru/RuBottomQuickLinks';
import { RuComplianceFooter } from '@/components/ru/RuComplianceFooter';
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { ListingIntakeDemo } from './ListingIntakeDemo';
import {
  operationPhases,
  operationScenarios,
} from '@/lib/operations';

export const metadata: Metadata = {
  title: 'Операционный модуль - ASI',
  description:
    'Операционный модуль ASI для автоматизации бронирований, подготовки заезда, поддержки проживания, выезда и повторной коммуникации с гостем.',
};

const scenarioLabels = [
  'Новая бронь',
  'Вопрос гостя',
  'Инцидент обслуживания',
  'Выезд',
  'Запрос отзыва',
  'Эскалация оператору',
];

export default function RuOperationsPage() {
  const handoffCount = operationScenarios.filter((scenario) => scenario.nextAction.handoffRequired).length;

  return (
    <ThemeProvider defaultTheme="light" className="theme-transition min-h-screen bg-[var(--t-bg)] text-[var(--t-text)]">
      <RuPublicNavHeader surface="theme" density="landing" showContacts={false} />

      <main>
        <section className="px-4 sm:px-6 py-16 sm:py-20 bg-[var(--t-bg)]">
          <div className="max-w-6xl mx-auto grid lg:grid-cols-[1.05fr_0.95fr] gap-10 lg:gap-14 items-start">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--t-muted)]">
                Operations MVP
              </p>
              <h1 className="mt-4 text-4xl sm:text-5xl font-bold tracking-tight text-[var(--t-text)]">
                Операционный слой для краткосрочной аренды
              </h1>
              <p className="mt-5 text-base sm:text-lg leading-relaxed text-[var(--t-text-2)] max-w-2xl">
                ASI ведет бронь от первого входящего запроса до отзыва после выезда: классифицирует обращения,
                запускает задачи, контролирует статусы и подключает оператора только там, где нужно решение человека.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-3">
                <Link
                  href="/ru/operations/workflow"
                  className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-[var(--t-accent)] text-white font-semibold text-sm hover:bg-[var(--t-accent-hover)] transition-colors"
                >
                  Смотреть workflow
                </Link>
                <Link
                  href="/connect"
                  className="inline-flex items-center justify-center px-6 py-3 rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] text-[var(--t-text)] font-semibold text-sm hover:bg-[var(--t-surface-2)] transition-colors"
                >
                  Демо: заявка на подключение
                </Link>
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--t-border)] bg-[var(--t-surface)] p-6 sm:p-7">
              <p className="text-sm font-semibold text-[var(--t-muted)]">Контур MVP</p>
              <dl className="mt-5 grid grid-cols-3 gap-3">
                <div>
                  <dt className="text-2xl font-bold text-[var(--t-text)]">{operationPhases.length}</dt>
                  <dd className="mt-1 text-xs text-[var(--t-muted)] leading-snug">фаз исполнения</dd>
                </div>
                <div>
                  <dt className="text-2xl font-bold text-[var(--t-text)]">{operationScenarios.length}</dt>
                  <dd className="mt-1 text-xs text-[var(--t-muted)] leading-snug">сценариев</dd>
                </div>
                <div>
                  <dt className="text-2xl font-bold text-[var(--t-text)]">{handoffCount}</dt>
                  <dd className="mt-1 text-xs text-[var(--t-muted)] leading-snug">handoff</dd>
                </div>
              </dl>
              <div className="mt-6 flex flex-wrap gap-2">
                {scenarioLabels.map((label) => (
                  <span
                    key={label}
                    className="inline-flex rounded-full border border-[var(--t-border)] bg-[var(--t-bg)] px-3 py-1 text-xs font-medium text-[var(--t-text-2)]"
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <ListingIntakeDemo />

        <section className="px-4 sm:px-6 py-14 sm:py-16 bg-[var(--t-surface-2)] border-y border-[var(--t-border)]">
          <div className="max-w-6xl mx-auto">
            <div className="max-w-3xl">
              <h2 className="text-2xl sm:text-3xl font-bold text-[var(--t-text)]">
                6 фаз операционного исполнения
              </h2>
              <p className="mt-3 text-base text-[var(--t-text-2)] leading-relaxed">
                Структура заложена под будущий intake бронирований, распределение контента по платформам,
                channel-manager-like слой, OTA off-ramp и автономное выполнение задач.
              </p>
            </div>
            <div className="mt-8 grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {operationPhases.map((phase) => (
                <article
                  key={phase.id}
                  className="rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] p-5"
                >
                  <div className="flex items-start gap-3">
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--t-accent)_12%,transparent)] text-sm font-bold text-[var(--t-text)]">
                      {phase.order}
                    </span>
                    <div>
                      <h3 className="font-semibold leading-snug text-[var(--t-text)]">{phase.titleRu}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-[var(--t-text-2)]">{phase.goalRu}</p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="px-4 sm:px-6 py-14 sm:py-16 bg-[var(--t-bg)]">
          <div className="max-w-6xl mx-auto grid lg:grid-cols-[0.85fr_1.15fr] gap-8 lg:gap-12">
            <div>
              <h2 className="text-2xl sm:text-3xl font-bold text-[var(--t-text)]">Что показывает демо</h2>
              <p className="mt-3 text-base text-[var(--t-text-2)] leading-relaxed">
                Workflow собирает в одном месте текущую фазу, следующий шаг, статус автоматизации, необходимость
                handoff и историю событий. Это минимум, с которого можно дальше наращивать настоящий операционный модуль.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              {[
                'Текущий этап по каждому сценарию',
                'Следующее действие и владелец',
                'Автоматический, полуавтоматический или ручной режим',
                'Причина передачи оператору',
              ].map((item) => (
                <div key={item} className="rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] p-5">
                  <p className="text-sm font-medium leading-relaxed text-[var(--t-text)]">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <RuBottomQuickLinks tone="theme" />
      <RuComplianceFooter tone="theme" />
    </ThemeProvider>
  );
}
