import type { Metadata } from 'next';
import Link from 'next/link';
import { EarlyAccessObjectForm } from '@/components/early-access/EarlyAccessObjectForm';
import { RuBottomQuickLinks } from '@/components/ru/RuBottomQuickLinks';
import { RuComplianceFooter } from '@/components/ru/RuComplianceFooter';
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';
import { ThemeProvider } from '@/theme/ThemeProvider';

export const metadata: Metadata = {
  title: 'Ранний доступ: AI-коммуникации для посуточной аренды — ASI',
  description: 'Закрытый пилот коммуникационного модуля для владельцев и управляющих посуточными объектами.',
};

const fitItems = [
  'Владельцам посуточных квартир.',
  'Управляющим несколькими объектами.',
  'Тем, кто отвечает гостям вручную и хочет снизить нагрузку.',
];

const moduleItems = [
  'Отвечает на типовые вопросы гостей.',
  'Помогает с инструкциями по заселению.',
  'Отвечает по Wi‑Fi, парковке, мусору, выезду и правилам.',
  'При невозможности голосового ответа отправляет текст.',
];

export default function RuEarlyAccessPage() {
  return (
    <ThemeProvider defaultTheme="light" className="theme-transition min-h-screen bg-[var(--t-bg)] text-[var(--t-text)]">
      <RuPublicNavHeader surface="theme" density="landing" />

      <main>
        <section className="px-4 py-12 sm:px-6 sm:py-16">
          <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--t-muted)]">Закрытый пилот</p>
              <h1 className="mt-4 max-w-3xl text-3xl font-bold leading-tight tracking-tight text-[var(--t-text)] sm:text-5xl">
                Ранний доступ: AI-коммуникации для посуточной аренды
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-8 text-[var(--t-text-2)] sm:text-lg">
                Закрытый пилот коммуникационного модуля для владельцев и управляющих посуточными объектами.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
                <a
                  href="#pilot-form"
                  className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[var(--t-accent)] px-7 py-3 text-sm font-bold text-white transition hover:bg-[var(--t-accent-hover)]"
                >
                  Подключить объект
                </a>
                <span className="inline-flex min-h-12 items-center rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] px-5 py-3 text-sm font-bold text-[var(--t-text)]">
                  1000 ₽/мес за объект
                </span>
              </div>
              <p className="mt-5 max-w-2xl text-sm leading-7 text-[var(--t-muted)]">
                Это не массовая платформа. Мы подключаем ограниченное количество объектов, чтобы проверить работу
                AI-коммуникаций на реальных гостях и спокойно донастроить процесс.
              </p>
            </div>

            <div className="rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] p-5 shadow-sm">
              <div className="space-y-3">
                <div className="max-w-[85%] rounded-lg bg-[var(--t-surface-2)] px-4 py-3">
                  <p className="text-xs font-semibold text-[var(--t-muted)]">Гость</p>
                  <p className="mt-1 text-sm text-[var(--t-text)]">Здравствуйте! Где парковка и какой пароль от Wi‑Fi?</p>
                </div>
                <div className="ml-auto max-w-[88%] rounded-lg bg-[color-mix(in_srgb,var(--t-accent)_14%,var(--t-surface))] px-4 py-3">
                  <p className="text-xs font-semibold text-[var(--t-muted)]">ASI</p>
                  <p className="mt-1 text-sm leading-6 text-[var(--t-text)]">
                    Парковка во дворе, места свободные по наличию. Wi‑Fi отправлю после проверки бронирования.
                  </p>
                </div>
                <div className="ml-auto max-w-[88%] rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] px-4 py-3">
                  <p className="text-xs font-semibold text-[var(--t-muted)]">Fallback</p>
                  <p className="mt-1 text-sm leading-6 text-[var(--t-text)]">
                    Если голосовой ответ не отправился, гость получает обычный текст без технических деталей.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-[var(--t-border)] bg-[var(--t-surface-2)] px-4 py-10 sm:px-6">
          <div className="mx-auto grid max-w-6xl gap-6 md:grid-cols-3">
            <div className="rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] p-5">
              <h2 className="text-lg font-bold text-[var(--t-text)]">Что подключаем</h2>
              <p className="mt-3 text-sm leading-7 text-[var(--t-text-2)]">
                Коммуникационный модуль для ответов гостям по конкретному объекту: заселение, правила, Wi‑Fi, парковка,
                мусор и выезд.
              </p>
            </div>
            <div className="rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] p-5">
              <h2 className="text-lg font-bold text-[var(--t-text)]">Цена пилота</h2>
              <p className="mt-3 text-2xl font-bold text-[var(--t-text)]">1000 ₽/мес</p>
              <p className="mt-2 text-sm leading-7 text-[var(--t-text-2)]">За один подключённый объект.</p>
            </div>
            <div className="rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] p-5">
              <h2 className="text-lg font-bold text-[var(--t-text)]">Формат</h2>
              <p className="mt-3 text-sm leading-7 text-[var(--t-text-2)]">
                Ограниченное количество объектов, ручная проверка подключения и честная обратная связь по работе модуля.
              </p>
            </div>
          </div>
        </section>

        <section className="px-4 py-12 sm:px-6 sm:py-16">
          <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-2">
            <div>
              <h2 className="text-2xl font-bold text-[var(--t-text)]">Кому подходит</h2>
              <ul className="mt-5 space-y-3">
                {fitItems.map((item) => (
                  <li key={item} className="rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] px-4 py-3 text-sm leading-6 text-[var(--t-text-2)]">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="text-2xl font-bold text-[var(--t-text)]">Что делает модуль</h2>
              <ul className="mt-5 space-y-3">
                {moduleItems.map((item) => (
                  <li key={item} className="rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] px-4 py-3 text-sm leading-6 text-[var(--t-text-2)]">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="border-t border-[var(--t-border)] bg-[var(--t-surface-2)] px-4 py-12 sm:px-6 sm:py-16">
          <div className="mx-auto max-w-4xl">
            <div className="mb-8">
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--t-muted)]">Анкета объекта</p>
              <h2 className="mt-3 text-2xl font-bold text-[var(--t-text)] sm:text-3xl">Оставить заявку на пилот</h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--t-text-2)]">
                Заполните данные объекта. После сохранения они попадут в базу знаний объекта и смогут использоваться
                для ответов AI-бота.
              </p>
            </div>
            <EarlyAccessObjectForm />
          </div>
        </section>

        <section className="px-4 py-10 sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-col gap-3 rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-bold text-[var(--t-text)]">Готовы подключить первый объект?</h2>
              <p className="mt-1 text-sm leading-6 text-[var(--t-text-2)]">Начнём с одного объекта и проверим работу на реальных обращениях гостей.</p>
            </div>
            <Link
              href="#pilot-form"
              className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[var(--t-accent)] px-6 py-3 text-sm font-bold text-white transition hover:bg-[var(--t-accent-hover)]"
            >
              Оставить заявку на пилот
            </Link>
          </div>
        </section>
      </main>

      <footer>
        <RuBottomQuickLinks tone="theme" />
        <RuComplianceFooter tone="theme" />
      </footer>
    </ThemeProvider>
  );
}
