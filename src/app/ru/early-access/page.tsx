import type { Metadata } from 'next';
import { EarlyAccessObjectForm } from '@/components/early-access/EarlyAccessObjectForm';
import { RuBottomQuickLinks } from '@/components/ru/RuBottomQuickLinks';
import { RuComplianceFooter } from '@/components/ru/RuComplianceFooter';
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';
import { ThemeProvider } from '@/theme/ThemeProvider';

export const metadata: Metadata = {
  title: 'Закрытый пилот ASI для объектов посуточной аренды',
  description:
    'Бесплатное пилотное подключение объекта к ASI: сбор данных, подготовка карточки и постепенная настройка управления.',
};

const pilotItems = [
  'Собираем основные данные объекта',
  'Готовим карточку для каналов размещения',
  'Помогаем настроить ответы гостям',
  'Показываем ручной и полуавтоматический режим работы',
  'Постепенно подключаем цены, доступность и каналы',
];

const roadmapItems = [
  {
    title: 'Ответы гостям',
    text: 'Сервис помогает готовить ответы на частые вопросы гостей и постепенно сокращать ручную переписку.',
  },
  {
    title: 'Каналы размещения',
    text: 'Данные объекта готовятся в одном месте, чтобы их было проще переносить и обновлять на подключённых площадках.',
  },
  {
    title: 'Цены и доступность',
    text: 'Постепенно добавляем рекомендации по ценам, календарь доступности и защиту от конфликтов бронирований.',
  },
  {
    title: 'Операционные задачи',
    text: 'В дальнейшем появятся задачи по уборке, подготовке к заезду, проверке объекта и другим действиям.',
  },
];

const securityItems = [
  {
    title: 'Не нужны пароли от личных кабинетов',
    text: 'Для пилотного подключения не требуется передавать пароли от Авито, Островка, Суточно, Циан или других площадок.',
  },
  {
    title: 'Нет доступа к вашим деньгам',
    text: 'ASI не запрашивает доступ к расчётным счетам, картам и выплатам.',
  },
  {
    title: 'Пилот начинается с открытых данных',
    text: 'Для старта достаточно информации об объекте: описание, правила, фото, Wi-Fi, заселение, базовые цены и ограничения.',
  },
];

const pricingRows = [
  ['Первые 30 дней', '0 ₽'],
  ['Период пилотной настройки', '0 ₽ для первых подключённых объектов'],
  [
    'После завершения пилота',
    'Условия согласуем отдельно. Для первых участников планируется льготная цена 1 000 ₽ за объект в год.',
  ],
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
              <h1 className="mt-4 max-w-4xl text-3xl font-bold leading-tight tracking-tight text-[var(--t-text)] sm:text-5xl">
                Подключите объект к ASI для бесплатного пилотного тестирования
              </h1>
              <p className="mt-5 max-w-3xl text-base leading-8 text-[var(--t-text-2)] sm:text-lg">
                Мы помогаем собрать данные объекта, подготовить карточку для каналов размещения и постепенно подключать
                управление сообщениями, ценами, доступностью и операционными задачами.
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
                    href="#pricing"
                    className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] px-7 py-3 text-sm font-bold text-[var(--t-text)] transition hover:bg-[var(--t-surface-2)]"
                  >
                    Бесплатный пилот
                  </a>
                </div>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-[var(--t-muted)]">
                  Пилот открыт для первых участников. Подключение проходит аккуратно, без передачи паролей от личных
                  кабинетов площадок и без доступа к вашим деньгам.
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] p-5 shadow-sm">
              <h2 className="text-xl font-bold text-[var(--t-text)]">Что входит в пилот</h2>
              <ul className="mt-5 space-y-3">
                {pilotItems.map((item) => (
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
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--t-muted)]">Главное</p>
            <h2 className="mt-4 text-2xl font-bold leading-tight text-[var(--t-text)] sm:text-4xl">
              ASI помогает собрать управление объектом в один рабочий контур
            </h2>
            <p className="mt-5 text-base leading-8 text-[var(--t-text-2)] sm:text-lg">
              На старте мы не обещаем мгновенный автопилот. Пилот нужен, чтобы спокойно подключить первые объекты,
              проверить данные, сценарии ответов, подготовку к каналам размещения и дальнейшую автоматизацию на реальных
              условиях.
            </p>
            <p className="mt-4 rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] p-5 text-sm leading-7 text-[var(--t-text-2)]">
              Сначала подключаем базовые данные объекта и ручной режим. Затем постепенно добавляем полуавтоматические
              действия, рекомендации по ценам, календарь, доступность и управление каналами.
            </p>
          </div>
        </section>

        <section className="px-4 py-12 sm:px-6 sm:py-16">
          <div className="mx-auto max-w-6xl">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--t-muted)]">Что ещё будет в сервисе</p>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {roadmapItems.map((item, index) => (
                <article key={item.title} className="rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] p-5">
                  <div className="flex items-start gap-3">
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--t-surface-2)] text-sm font-bold text-[var(--t-text)]">
                      {index + 1}
                    </span>
                    <h2 className="text-lg font-bold text-[var(--t-text)]">{item.title}</h2>
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
                <article key={item.title} className="rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] p-5">
                  <h2 className="text-lg font-bold text-[var(--t-text)]">{item.title}</h2>
                  <p className="mt-3 text-sm leading-7 text-[var(--t-text-2)]">{item.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="pricing" className="scroll-mt-24 px-4 py-12 sm:px-6 sm:py-16">
          <div className="mx-auto max-w-5xl">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--t-muted)]">Стоимость пилотного подключения</p>
            <div className="mt-6 overflow-hidden rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)]">
              <div className="grid grid-cols-[0.9fr_1.1fr] border-b border-[var(--t-border)] bg-[var(--t-surface-2)] text-sm font-bold text-[var(--t-text)]">
                <div className="px-4 py-3">Период</div>
                <div className="border-l border-[var(--t-border)] px-4 py-3">Стоимость</div>
              </div>
              {pricingRows.map(([period, price]) => (
                <div key={period} className="grid grid-cols-[0.9fr_1.1fr] border-b border-[var(--t-border)] text-sm leading-6 text-[var(--t-text-2)] last:border-b-0">
                  <div className="px-4 py-4 font-semibold text-[var(--t-text)]">{period}</div>
                  <div className="border-l border-[var(--t-border)] px-4 py-4">{price}</div>
                </div>
              ))}
            </div>
            <p className="mt-5 rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] p-5 text-sm leading-7 text-[var(--t-text-2)]">
              Пока продукт проходит пилотную обкатку, мы не берём оплату за подключение первых объектов. Оплата обсуждается
              только после того, как базовый функционал станет полезен на практике.
            </p>
          </div>
        </section>

        <section className="border-t border-[var(--t-border)] bg-[var(--t-surface-2)] px-4 py-12 sm:px-6 sm:py-16">
          <div className="mx-auto max-w-4xl">
            <div className="mb-8">
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--t-muted)]">Заявка</p>
              <h2 className="mt-3 text-2xl font-bold text-[var(--t-text)] sm:text-3xl">
                Подключить объект к пилоту
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--t-text-2)]">
                Оставьте контакты и краткую информацию об объекте. Мы свяжемся, уточним данные и поможем пройти первые
                шаги подключения.
              </p>
              <p className="mt-3 max-w-3xl rounded-lg border border-[var(--t-border)] bg-[var(--t-surface)] p-5 text-sm leading-7 text-[var(--t-text-2)]">
                Для старта понадобятся: адрес или район, тип объекта, фото, описание, правила проживания, условия
                заселения, Wi-Fi, базовая цена и список площадок, где объект уже размещён.
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
