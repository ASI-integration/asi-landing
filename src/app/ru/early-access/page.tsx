import type { Metadata } from 'next';
import { EarlyAccessObjectForm } from '@/components/early-access/EarlyAccessObjectForm';
import { RuBottomQuickLinks } from '@/components/ru/RuBottomQuickLinks';
import { RuComplianceFooter } from '@/components/ru/RuComplianceFooter';
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';
import { ThemeProvider } from '@/theme/ThemeProvider';

export const metadata: Metadata = {
  title: 'Ранний доступ: автопилот для посуточной недвижимости - ASI',
  description: 'Ранний доступ ASI для владельцев и управляющих посуточной недвижимостью.',
};

const featureItems = [
  {
    title: 'Круглосуточные ответы гостям без постоянного сидения в телефоне',
    label: 'Уже можно подключить',
    text: 'Сервис помогает отвечать гостям в Telegram текстом и голосом круглосуточно: про заселение, Wi-Fi, парковку, правила объекта, заезд, выезд, уборку и бытовые вопросы. Владелец подключается только к срочным, важным или нестандартным ситуациям, где нужно решение человека.',
  },
  {
    title: 'Встроенный менеджер каналов',
    text: 'Синхронизация площадок (Avito, Островок, Суточно.ру и др.) зашита прямо в ядро ASI. Забудьте об отдельных счетах сторонним сервисам.',
  },
  {
    title: 'Модуль умного ценообразования',
    text: 'Автоматическое выставление посуточных тарифов на основе больших данных: аналитика спроса, тепловые карты, кадастр и планы развития города.',
  },
  {
    title: 'Инструмент анализа локаций',
    text: 'Оценка инвестиционного потенциала жилой и коммерческой недвижимости с горизонтом до 10 лет для аренды или покупки.',
  },
  {
    title: 'Операционный блок',
    text: 'Полный контроль и автоматизация уборок, сбора отзывов, бронирований и умных замков.',
  },
  {
    title: 'Полный автопилот',
    text: 'Уже на начальных этапах, после базовой настройки и подключения менеджера каналов, система начинает самостоятельно вести процессы, практически полностью заменяя ручной труд. В финальном виде ASI забирает на себя до 99% всех вопросов краткосрочной аренды.',
  },
];

const securityItems = [
  {
    mark: '🔐',
    text: 'Нам не нужны ваши пароли от личных кабинетов Avito, Островок, Суточно.ру или Циан.',
  },
  {
    mark: '❌',
    text: 'Нам не нужен доступ к вашим деньгам, расчетным счетам или картам.',
  },
  {
    mark: '🤖',
    text: 'Контролируемый ИИ: для теста нужны только открытые данные: памятка гостя, Wi-Fi, адрес и основные данные по объектам. Если ИИ столкнется со сложным вопросом, система мгновенно переведет диалог на понятный текстовый сценарий — гость всегда получит помощь.',
  },
];

const pricingRows = [
  ['Первые 7–14 дней', '0 ₽ (тест-драйв системы)'],
  ['До 31 августа 2026 года', '1 000 ₽ / мес. за объект'],
  ['С 1 сентября 2026 года', '3 000 ₽ за объект / мес. на 12 месяцев (всего 100 ₽ в сутки — цена чашки кофе)'],
];

export default function RuEarlyAccessPage() {
  return (
    <ThemeProvider defaultTheme="light" className="theme-transition min-h-screen bg-[var(--t-bg)] text-[var(--t-text)]">
      <RuPublicNavHeader surface="theme" density="landing" />

      <main>
        <section className="px-4 py-12 sm:px-6 sm:py-16">
          <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--t-muted)]">Первые подключения</p>
              <h1 className="mt-4 max-w-4xl text-3xl font-bold leading-tight tracking-tight text-[var(--t-text)] sm:text-5xl">
                Умные ответы гостям для посуточной аренды
              </h1>
              <p className="mt-5 max-w-3xl text-base leading-8 text-[var(--t-text-2)] sm:text-lg">
                Сервис помогает отвечать на частые вопросы гостей, не пропускать важные сообщения и сокращать рутину в переписке.
              </p>
              <div className="mt-7">
                <div className="flex flex-wrap gap-3">
                  <a
                    href="#pilot-form"
                    className="inline-flex min-h-12 items-center justify-center rounded-lg bg-[var(--t-accent)] px-7 py-3 text-sm font-bold text-white transition hover:bg-[var(--t-accent-hover)]"
                  >
                    Подключить объект
                  </a>
                  <a
                    href="#pilot-form"
                    className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] px-7 py-3 text-sm font-bold text-[var(--t-text)] transition hover:bg-[var(--t-surface-2)]"
                  >
                    1000 ₽/мес за объект
                  </a>
                </div>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--t-muted)]">
                  Подключаем ограниченное количество объектов, чтобы спокойно проверить работу сервиса на реальных гостях и донастроить сценарии под владельцев.
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] p-5 shadow-sm">
              <h2 className="text-xl font-bold text-[var(--t-text)]">Что делает сервис</h2>
              <ul className="mt-5 space-y-3">
                {[
                  'Отвечает на частые вопросы гостей',
                  'Помогает сократить рутину в переписке',
                  'Отправляет текстовый ответ, если голос недоступен',
                ].map((item) => (
                  <li key={item} className="rounded-lg border border-[var(--t-border)] bg-[var(--t-surface-2)] px-4 py-3 text-sm leading-6 text-[var(--t-text-2)]">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="border-y border-[var(--t-border)] bg-[var(--t-surface-2)] px-4 py-12 sm:px-6 sm:py-16">
          <div className="mx-auto max-w-5xl">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--t-muted)]">Главный инсайт</p>
            <h2 className="mt-4 text-2xl font-bold leading-tight text-[var(--t-text)] sm:text-4xl">
              ASI — это не очередная система управления, не чат-бот и не просто «помощник».
            </h2>
            <p className="mt-5 text-base leading-8 text-[var(--t-text-2)] sm:text-lg">
              Это полноценный цифровой управляющий вашим бизнесом, который делает почти всю работу ЗА ВАС. Вам больше не нужно связывать между собой пять разных сервисов и круглосуточно сидеть в телефоне. Мы объединили всё в одном ядре.
            </p>
          </div>
        </section>

        <section className="px-4 py-12 sm:px-6 sm:py-16">
          <div className="mx-auto max-w-6xl">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--t-muted)]">Что под капотом системы?</p>
            <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {featureItems.map((item, index) => (
                <article key={item.title} className="rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] p-5">
                  <div className="flex items-start gap-3">
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--t-surface-2)] text-sm font-bold text-[var(--t-text)]">
                      {index + 1}
                    </span>
                    <div>
                      <h2 className="text-lg font-bold text-[var(--t-text)]">{item.title}</h2>
                      {item.label ? <p className="mt-1 text-xs font-semibold text-[var(--t-muted)]">({item.label})</p> : null}
                    </div>
                  </div>
                  <p className="mt-4 text-sm leading-7 text-[var(--t-text-2)]">{item.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-y border-[var(--t-border)] bg-[var(--t-surface-2)] px-4 py-12 sm:px-6 sm:py-16">
          <div className="mx-auto max-w-6xl">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--t-muted)]">Безопасность</p>
            <div className="mt-6 grid gap-4 lg:grid-cols-3">
              {securityItems.map((item) => (
                <div key={item.text} className="rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] p-5">
                  <span className="text-2xl" aria-hidden="true">
                    {item.mark}
                  </span>
                  <p className="mt-3 text-sm leading-7 text-[var(--t-text-2)]">{item.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-4 py-12 sm:px-6 sm:py-16">
          <div className="mx-auto max-w-5xl">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--t-muted)]">Стоимость и прозрачные условия</p>
            <div className="mt-6 overflow-hidden rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)]">
              <div className="grid grid-cols-[0.9fr_1.1fr] border-b border-[var(--t-border)] bg-[var(--t-surface-2)] text-sm font-bold text-[var(--t-text)]">
                <div className="px-4 py-3">Период</div>
                <div className="border-l border-[var(--t-border)] px-4 py-3">Стоимость за 1 объект</div>
              </div>
              {pricingRows.map(([period, price]) => (
                <div key={period} className="grid grid-cols-[0.9fr_1.1fr] border-b border-[var(--t-border)] text-sm leading-6 text-[var(--t-text-2)] last:border-b-0">
                  <div className="px-4 py-4 font-semibold text-[var(--t-text)]">{period}</div>
                  <div className="border-l border-[var(--t-border)] px-4 py-4">{price}</div>
                </div>
              ))}
            </div>
            <p className="mt-5 rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] p-5 text-sm leading-7 text-[var(--t-text-2)]">
              🛡 Полная свобода и никаких обязательств. Если по какой-либо причине система вам не подошла, вы можете отменить подписку в один клик. Сервис продолжит полноценно работать на ваших объектах до окончания уже оплаченного периода.
            </p>
          </div>
        </section>

        <section className="border-t border-[var(--t-border)] bg-[var(--t-surface-2)] px-4 py-12 sm:px-6 sm:py-16">
          <div className="mx-auto max-w-4xl">
            <div className="mb-8">
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--t-muted)]">Финальный шаг</p>
              <h2 className="mt-3 text-2xl font-bold text-[var(--t-text)] sm:text-3xl">
                Оставьте заявку на ранний доступ.
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--t-text-2)]">
                Индивидуальная помощь на каждом этапе подключения и последующего использования сервиса.
              </p>
            </div>
            <EarlyAccessObjectForm />
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
