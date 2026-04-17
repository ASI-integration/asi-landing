import Link from 'next/link';
import { productSupportEmail } from '@/config/contact';
import { FaqAccordion } from '@/components/FaqAccordion';
import { HeroSection } from '@/components/HeroSection';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { TgIcon } from '@/components/TgIcon';
import { RuBottomQuickLinks } from '@/components/ru/RuBottomQuickLinks';
import { RuComplianceFooter } from '@/components/ru/RuComplianceFooter';
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';

const DEMO_LINK = '/connect';

/* ─── Platform modules ──────────────────────────────────────────────────────── */
const MODULES = [
  {
    id: 'real-estate',
    name: 'Автопилот для недвижимости',
    status: 'ACTIVE' as const,
    desc: 'Ведёт коммуникации с гостями, операции, платежи и контроль от начала до конца.',
  },
  {
    id: 'security',
    name: 'Автопилот безопасности',
    status: 'COMING SOON' as const,
    desc: 'Мониторит события, исполняет правила доступа и автоматически реагирует на инциденты.',
  },
  {
    id: 'market',
    name: 'Автоматизация рынка',
    status: 'COMING SOON' as const,
    desc: 'Ведёт клиентские потоки, транзакции и операционные процессы без отдельного операционного стола.',
  },
];

/* ─── Что автоматизируется ───────────────────────────────────────────────────── */
const AUTOMATED_ITEMS = [
  {
    title: 'Коммуникация с гостями',
    desc: 'ИИ отвечает мгновенно, 24/7 — заменяет стойку и мониторинг почты.',
  },
  {
    title: 'Управление объявлениями',
    desc: 'Создание, обновления и синхронизация по каналам — заменяет администратора листингов.',
  },
  {
    title: 'Ценообразование',
    desc: 'Автоматически подстраивается под сигналы спроса — заменяет ручной тарифный стол.',
  },
  {
    title: 'Обработка бронирований',
    desc: 'Подтверждения и календарь исполняются автоматически — заменяет координатора броней.',
  },
  {
    title: 'Отзывы',
    desc: 'Запросы и ответы по политике — заменяет ручную работу с репутацией.',
  },
  {
    title: 'Инциденты и вопросы',
    desc: 'ИИ доводит большинство кейсов до решения — заменяет первую линию поддержки.',
  },
  {
    title: 'Синхронизация каналов',
    desc: 'Работает с площадками; заменяет менеджеров каналов и табличный операционный контур.',
  },
  {
    title: 'Финансовый учёт',
    desc: 'Доход, показатели и прогнозы собираются автоматически — заменяет операционную отчётность.',
  },
];

/* ─── Cards ─────────────────────────────────────────────────────────────────── */
const CARDS = [
  {
    icon: '📥',
    title: 'Коммуникация с гостями',
    desc: 'Ведёт входящие обращения гостей круглосуточно — без задержек и пропущенных тредов.',
  },
  {
    icon: '📋',
    title: 'Сбор данных и приём заявок',
    desc: 'Исполняет квалификацию и сбор данных целиком — заменяет сотрудника на приёме.',
  },
  {
    icon: '🔄',
    title: 'Рабочие процессы и расписание',
    desc: 'Коды доступа, уборка, повторяющиеся задачи — система выполняет и закрывает автоматически.',
  },
  {
    icon: '💳',
    title: 'Платежи и монетизация',
    desc: 'Доплаты, поздний выезд, дополнительные услуги — счёт в чате, оплата в один клик.',
  },
  {
    icon: '📊',
    title: 'Динамическое ценообразование',
    desc: 'Тарифы двигаются со спросом, конкурентами и загрузкой — без ревеню-менеджера в контуре.',
  },
  {
    icon: '🔔',
    title: 'Редкий вызов оператора',
    desc: 'Истинные исключения уходят человеку с полным контекстом. Всё остальное исполняется автоматически.',
  },
  {
    icon: '🔒',
    title: 'Безопасность и контроль доступа',
    desc: 'Мониторинг в реальном времени, контроль доступа, обнаружение инцидентов и автоматические сценарии реагирования.',
  },
];

/* ─── Contacts ──────────────────────────────────────────────────────────────── */
function ContactLinks({ orientation = 'row' }: { orientation?: 'row' | 'col' }) {
  const cls = orientation === 'row'
    ? 'flex flex-col sm:flex-row justify-center gap-4'
    : 'flex flex-col gap-3';

  return (
    <div className={cls}>
      <a
        href="https://t.me/ASI_core_bot"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Telegram"
        title="Telegram"
        className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-[#2CA5E0]/10 border border-[#2CA5E0]/30 text-white hover:bg-[#2CA5E0]/20 hover:border-[#2CA5E0]/60 transition-all"
      >
        <TgIcon />
        <span className="sr-only">Telegram</span>
      </a>
      <a
        href={`mailto:${productSupportEmail}`}
        className="inline-flex items-center justify-center gap-3 px-6 py-3.5 rounded-xl bg-[var(--t-surface)] border border-[var(--t-border)] text-[var(--t-text)] font-semibold text-sm hover:bg-[var(--t-surface-2)] transition-all"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-[var(--t-muted)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25H4.5a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5H4.5a2.25 2.25 0 00-2.25 2.25m19.5 0L12 13.5 2.25 6.75" />
        </svg>
        {productSupportEmail}
      </a>
    </div>
  );
}

/* ─── Page ──────────────────────────────────────────────────────────────────── */
export default function HomeRu() {
  return (
    <ThemeProvider defaultTheme="light" className="theme-transition min-h-screen bg-[var(--t-bg)] text-[var(--t-text)]">

      <RuPublicNavHeader surface="theme" density="landing" />

      <main>

        {/* ── Hero ── */}
        <HeroSection content={{
          aboutLabel: 'О системе',
          aboutHeadline: 'Система операционной автоматизации',
          aboutBody: 'ASI — это не дашборд и не ПО, которым вы управляете вручную. Это операционная инфраструктура: ИИ-слой, который ведёт ваш портфель объектов от начала до конца — без персонала и ручного контроля.',
          aboutPoints: [
            'Не дашборд',
            'Не ПО для ручного управления',
            'Заменяет операционный слой целиком',
          ],
          detailsLabel: 'Контакты',
          loginLabel: 'Войти',
          loginHref: '/login',
          offerHeadline: 'Автопилот для вашего арендного бизнеса',
          offerSub: 'ASI автоматизирует операционный контур: от входящих обращений и коммуникации с гостями до аналитики спроса и доходности. Два рабочих модуля доступны уже сейчас.',
          ctaLabel: 'Запросить разбор объектов',
          ctaHref: DEMO_LINK,
          ctaExternal: false,
        }} telegramVariant="icon" />

        {/* ── Два рабочих модуля ── */}
        <section className="py-16 sm:py-20 px-4 sm:px-6 bg-[var(--t-surface-2)] border-t-2 border-[color:var(--t-accent)]">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-[var(--t-text)] mb-2">
              Два рабочих модуля уже доступны
            </h2>
            <p className="text-[var(--t-text-2)] text-base sm:text-lg mb-8 max-w-2xl">
              Уже сейчас ASI помогает обрабатывать входящие обращения, вести коммуникацию с гостями и оценивать потенциал объекта по локации, спросу и доходности.
            </p>
            <div className="grid sm:grid-cols-2 gap-5">

              {/* Card 1 — Коммуникационный модуль */}
              <div className="flex flex-col p-6 rounded-2xl border-2 border-[color:var(--t-accent)] bg-[color-mix(in_srgb,var(--t-accent)_8%,var(--t-surface))]">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h3 className="font-bold text-[var(--t-text)] text-base leading-snug">
                    Коммуникационный модуль
                  </h3>
                  <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-600 border border-emerald-500/30">
                    Доступно
                  </span>
                </div>
                <p className="text-sm text-[var(--t-text-2)] leading-relaxed flex-1">
                  Принимает входящие обращения, ведёт переписку с гостями, автоматизирует ответы и снижает нагрузку на операционный контур.
                </p>
                <Link
                  href="/connect"
                  className="mt-5 inline-flex items-center justify-center px-5 py-3 rounded-xl bg-[color:var(--t-accent)] text-white font-semibold text-sm hover:bg-[color:var(--t-accent-hover)] transition-all"
                >
                  Запросить подключение →
                </Link>
              </div>

              {/* Card 2 — Модуль оценки локации */}
              <div className="flex flex-col p-6 rounded-2xl border-2 border-[color:var(--t-accent)] bg-[color-mix(in_srgb,var(--t-accent)_8%,var(--t-surface))]">
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h3 className="font-bold text-[var(--t-text)] text-base leading-snug">
                    Модуль оценки локации
                  </h3>
                  <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-600 border border-emerald-500/30">
                    Доступно
                  </span>
                </div>
                <p className="text-sm text-[var(--t-text-2)] leading-relaxed flex-1">
                  Оценивает спрос, окружение, магниты трафика, конкуренцию и потенциальную доходность объекта до запуска.
                </p>
                <Link
                  href="/ru/location-analysis"
                  className="mt-5 inline-flex items-center justify-center px-5 py-3 rounded-xl bg-[color:var(--t-accent)] text-white font-semibold text-sm hover:bg-[color:var(--t-accent-hover)] transition-all"
                >
                  Открыть анализ локации →
                </Link>
              </div>

            </div>
          </div>
        </section>

        {/* ── Почему ASI уже сейчас ── */}
        <section className="py-16 sm:py-20 px-4 sm:px-6 bg-[var(--t-bg)] border-t border-[var(--t-border)]">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-[var(--t-text)] mb-2">
              Почему ASI уже сейчас
            </h2>
            <p className="text-[var(--t-text-2)] text-base sm:text-lg mb-8 max-w-2xl">
              Два модуля уже работают в боевом режиме. Мы показываем не обещания, а реальные сценарии использования.
            </p>
            <div className="grid sm:grid-cols-3 gap-5">

              <div className="flex flex-col p-6 rounded-2xl border border-[var(--t-border)] bg-[var(--t-surface)]">
                <span className="text-xs font-semibold uppercase tracking-widest text-[var(--t-muted)] mb-3">
                  Сценарий 1
                </span>
                <h3 className="font-bold text-[var(--t-text)] text-base leading-snug mb-3">
                  Входящее обращение вечером
                </h3>
                <p className="text-sm text-[var(--t-text-2)] leading-relaxed">
                  Гость пишет вечером. Система принимает обращение, отвечает без задержки, собирает нужные данные и переводит сценарий дальше по цепочке.
                </p>
              </div>

              <div className="flex flex-col p-6 rounded-2xl border border-[var(--t-border)] bg-[var(--t-surface)]">
                <span className="text-xs font-semibold uppercase tracking-widest text-[var(--t-muted)] mb-3">
                  Сценарий 2
                </span>
                <h3 className="font-bold text-[var(--t-text)] text-base leading-snug mb-3">
                  Объект недозагружен
                </h3>
                <p className="text-sm text-[var(--t-text-2)] leading-relaxed">
                  Система показывает слабые точки по локации, спросу и окружению, чтобы можно было скорректировать стратегию до потери доходности.
                </p>
              </div>

              <div className="flex flex-col p-6 rounded-2xl border border-[var(--t-border)] bg-[var(--t-surface)]">
                <span className="text-xs font-semibold uppercase tracking-widest text-[var(--t-muted)] mb-3">
                  Сценарий 3
                </span>
                <h3 className="font-bold text-[var(--t-text)] text-base leading-snug mb-3">
                  Оператор работает с портфелем
                </h3>
                <p className="text-sm text-[var(--t-text-2)] leading-relaxed">
                  Один интерфейс вместо ручной координации между сообщениями, задачами, доступами и аналитикой по объектам.
                </p>
              </div>

            </div>
          </div>
        </section>

        {/* ── Что автоматизируется в ASI ── */}
        <section className="py-16 sm:py-20 px-4 sm:px-6 bg-[var(--t-bg)] border-t border-[var(--t-border)]">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-[var(--t-text)] mb-2">
              Что автоматизируется в ASI
            </h2>
            <p className="text-[var(--t-text-2)] text-base sm:text-lg mb-8 max-w-2xl">
              Конкретные операционные функции — не обещания. Система исполняет их без участия команды.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                {
                  title: 'Входящие обращения',
                  desc: 'Принимает запросы гостей круглосуточно, без пропущенных тредов и задержек.',
                },
                {
                  title: 'Переписка с гостями',
                  desc: 'ИИ ведёт диалог, отвечает на типовые и нетиповые вопросы, собирает данные.',
                },
                {
                  title: 'Бронирования',
                  desc: 'Подтверждения, изменения и отмены обрабатываются автоматически по триггеру.',
                },
                {
                  title: 'Платежи',
                  desc: 'Доплаты, ранний заезд, поздний выезд — счёт в чате, оплата в один клик.',
                },
                {
                  title: 'Доступы и check-in',
                  desc: 'Коды доступа генерируются и отправляются автоматически по триггеру бронирования.',
                },
                {
                  title: 'Задачи и инциденты',
                  desc: 'Уборка, ремонт, исключения — система создаёт задачи, назначает и контролирует исполнение.',
                },
                {
                  title: 'Аналитика спроса и доходности',
                  desc: 'Данные по загрузке, конкурентам и потенциалу объекта собираются без участия оператора.',
                },
              ].map((item) => (
                <div
                  key={item.title}
                  className="p-5 rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)]"
                >
                  <h3 className="font-semibold text-[var(--t-text)] text-sm leading-snug">{item.title}</h3>
                  <p className="mt-1.5 text-sm text-[var(--t-muted)] leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Не CRM, не channel manager, не PMS ── */}
        <section className="py-16 sm:py-20 px-4 sm:px-6 bg-[var(--t-surface-2)] border-t border-[var(--t-border)]">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-[var(--t-text)] mb-2">
              Не CRM, не channel manager, не PMS
            </h2>
            <p className="text-[var(--t-text-2)] text-base sm:text-lg mb-8 max-w-2xl">
              Все эти инструменты требуют операторов, которые их используют. ASI — это слой исполнения: система сама ведёт операции от начала до конца.
            </p>
            <div className="grid sm:grid-cols-2 gap-4 mb-8">
              {[
                {
                  label: 'CRM',
                  gap: 'Фиксирует данные. Требует оператора, который с ними работает.',
                },
                {
                  label: 'Channel manager',
                  gap: 'Синхронизирует площадки. Не ведёт коммуникацию и не принимает решений.',
                },
                {
                  label: 'PMS',
                  gap: 'Управляет объектами. Не обрабатывает гостей и не закрывает инциденты.',
                },
                {
                  label: 'Точечная автоматизация',
                  gap: 'Закрывает одну функцию. Остальные всё равно требуют ручного труда.',
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="flex gap-4 p-5 rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)]"
                >
                  <span className="mt-0.5 shrink-0 text-[var(--t-muted)]" aria-hidden>✗</span>
                  <div>
                    <p className="font-semibold text-[var(--t-text)] text-sm">{item.label}</p>
                    <p className="mt-1 text-sm text-[var(--t-muted)] leading-relaxed">{item.gap}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-4 p-6 rounded-2xl border-2 border-[color:var(--t-accent)] bg-[color-mix(in_srgb,var(--t-accent)_8%,var(--t-surface))]">
              <span className="mt-0.5 shrink-0 text-emerald-500" aria-hidden>✓</span>
              <div>
                <p className="font-bold text-[var(--t-text)] text-base">ASI — операционный слой</p>
                <p className="mt-1 text-sm text-[var(--t-text-2)] leading-relaxed">
                  Заменяет операционный контур целиком: принимает обращения, ведёт гостей, исполняет задачи, контролирует платежи и доступы — без команды операторов в цепочке.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Растёт вместе с вами ── */}
        <section id="scale" className="scroll-mt-20 py-16 sm:py-20 px-4 sm:px-6 bg-[var(--t-bg)] border-t border-[var(--t-border)]">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-[var(--t-text)] mb-2">
              Растёт вместе с вами
            </h2>
            <p className="text-[var(--t-text-2)] text-base sm:text-lg mb-8 max-w-2xl">
              Один объект или сотня. ASI справляется с разным масштабом без перестройки процессов.
            </p>
            <div className="grid sm:grid-cols-3 gap-5">
              {[
                {
                  label: '1 объект',
                  title: 'Для собственника одной квартиры',
                  body: 'Автоматизирует обработку обращений, коммуникацию, платежи и базовые операционные сценарии без найма дополнительного персонала.',
                },
                {
                  label: '10 объектов',
                  title: 'Для оператора портфеля',
                  body: 'Даёт единый контур управления по нескольким объектам: входящие обращения, задачи, доступы, коммуникация и видимость по доходности.',
                },
                {
                  label: '100+ объектов',
                  title: 'Для управляющей компании',
                  body: 'Масштабирует операционный контур без ручной координации между командами и разрозненными инструментами.',
                },
              ].map(({ label, title, body }) => (
                <div key={label} className="flex flex-col p-6 rounded-2xl border border-[var(--t-border)] bg-[var(--t-surface)]">
                  <span className="text-xs font-bold uppercase tracking-widest text-[var(--t-muted)] mb-3">{label}</span>
                  <h3 className="font-bold text-[var(--t-text)] text-base leading-snug mb-3">{title}</h3>
                  <p className="text-sm text-[var(--t-text-2)] leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Слой исполнения ── */}
        <section className="py-20 sm:py-24 px-4 sm:px-6 bg-[var(--t-surface-2)] border-t border-[var(--t-border)]">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-[var(--t-text)] mb-3">
              Слой исполнения
            </h2>
            <p className="text-[var(--t-muted)] text-lg mb-10">
              Работа, которая лежала на операционном отделе, — система ведёт от начала до конца.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {CARDS.map((card) => (
                <div
                  key={card.title}
                  className="p-5 rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)]"
                >
                  <span className="text-2xl" aria-hidden>{card.icon}</span>
                  <h3 className="mt-3 font-semibold text-[var(--t-text)] text-sm leading-snug">{card.title}</h3>
                  <p className="mt-1.5 text-sm text-[var(--t-muted)] leading-relaxed">{card.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Модули платформы ── */}
        <section id="platform-modules" className="scroll-mt-20 py-20 sm:py-24 px-4 sm:px-6 bg-[var(--t-bg)] border-t border-[var(--t-border)]">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-[var(--t-text)] mb-3">
              Модули платформы
            </h2>
            <p className="text-[var(--t-muted)] text-lg mb-10">
              Автономные системы на одной инфраструктуре — каждая ведёт свой домен.
            </p>
            <div className="grid sm:grid-cols-3 gap-4">
              {MODULES.map((mod) => {
                const isActive = mod.status === 'ACTIVE';
                return (
                  <div
                    key={mod.id}
                    className={`p-6 rounded-xl border transition-all ${
                      isActive
                        ? 'border-[color:var(--t-accent)] bg-[color-mix(in_srgb,var(--t-accent)_10%,transparent)]'
                        : 'border-[var(--t-border)] bg-[var(--t-surface)]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <h3 className={`font-semibold text-sm leading-snug ${isActive ? 'text-[var(--t-text)]' : 'text-[var(--t-text-2)]'}`}>
                        {mod.name}
                      </h3>
                      <span
                        className={`shrink-0 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${
                          isActive
                            ? 'bg-[color-mix(in_srgb,var(--t-accent)_18%,transparent)] text-[var(--t-text)] border border-[color:var(--t-accent)]'
                            : 'bg-[var(--t-surface-2)] text-[var(--t-muted)] border border-[var(--t-border)]'
                        }`}
                      >
                        {isActive ? 'АКТИВНО' : 'СКОРО'}
                      </span>
                    </div>
                    <p className={`text-sm leading-relaxed ${isActive ? 'text-[var(--t-text-2)]' : 'text-[var(--t-muted)]'}`}>
                      {mod.desc}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── Тарифы ── */}
        <section id="pricing" className="scroll-mt-20 py-20 sm:py-24 px-4 sm:px-6 bg-[var(--t-surface-2)] border-t border-[var(--t-border)]">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-[var(--t-text)] mb-3">
              Тарифы
            </h2>
            <p className="text-[var(--t-text-2)] text-lg leading-relaxed mb-10">
              Выберите формат подключения под ваш масштаб и задачи.
            </p>
            <div className="grid sm:grid-cols-3 gap-6">

              {/* Owner */}
              <Link
                href="/connect?plan=small"
                className="p-6 rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] hover:bg-[var(--t-surface-2)] transition-all flex flex-col min-h-[420px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--t-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--t-bg)]"
                aria-label="Выбрать тариф Для собственника"
              >
                <span className="inline-block self-start px-3 py-1 bg-emerald-500/10 text-emerald-700 text-xs font-medium rounded-full border border-emerald-500/20">
                  1–3 объекта
                </span>
                <p className="mt-4 text-xl font-semibold text-[var(--t-text)]">
                  12 900 ₽ / объект / месяц
                </p>
                <p className="mt-1 text-sm text-[var(--t-muted)] font-medium">
                  Для собственника
                </p>
                <p className="mt-4 text-[var(--t-text-2)] text-sm leading-relaxed flex-1">
                  Подходит для собственников, которые хотят автоматизировать входящие обращения, коммуникацию с гостями и базовые операционные сценарии без найма дополнительного персонала.
                </p>
                <div className="mt-6" aria-hidden />
              </Link>

              {/* Operator */}
              <Link
                href="/connect?plan=growth"
                className="p-6 rounded-xl border border-[color:var(--t-accent)] bg-[color-mix(in_srgb,var(--t-accent)_10%,transparent)] hover:bg-[color-mix(in_srgb,var(--t-accent)_14%,transparent)] transition-all flex flex-col min-h-[420px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--t-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--t-bg)]"
                aria-label="Выбрать тариф Для оператора"
              >
                <span className="inline-block self-start px-3 py-1 bg-amber-500/10 text-amber-400 text-xs font-medium rounded-full border border-amber-500/20">
                  До 15 объектов
                </span>
                <p className="mt-4 text-xl font-semibold text-[var(--t-text)]">
                  8 900 ₽ / объект / месяц
                </p>
                <p className="mt-1 text-sm text-[var(--t-text-2)] font-medium">
                  Для оператора
                </p>
                <p className="mt-4 text-[var(--t-text-2)] text-sm leading-relaxed flex-1">
                  Для операторов, которым нужен единый контур работы с несколькими объектами: коммуникация, обращения, задачи, доступы и видимость по доходности.
                </p>
                <div className="mt-6" aria-hidden />
              </Link>

              {/* Management company */}
              <Link
                href="/connect?plan=enterprise"
                className="p-6 rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] hover:bg-[var(--t-surface-2)] transition-all flex flex-col min-h-[420px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--t-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--t-bg)]"
                aria-label="Выбрать тариф Для управляющей компании"
              >
                <span className="inline-block self-start px-3 py-1 bg-blue-500/10 text-blue-400 text-xs font-medium rounded-full border border-blue-500/20">
                  Индивидуально
                </span>
                <p className="mt-4 text-xl font-semibold text-[var(--t-text)]">
                  По запросу
                </p>
                <p className="mt-1 text-sm text-[var(--t-muted)] font-medium">
                  Для управляющей компании
                </p>
                <p className="mt-4 text-[var(--t-text-2)] text-sm leading-relaxed flex-1">
                  Для портфелей с большим числом объектов, кастомной логикой процессов и отдельными требованиями к внедрению и поддержке.
                </p>
                <div className="mt-6" aria-hidden />
              </Link>

            </div>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section id="faq" className="scroll-mt-20 py-20 sm:py-24 px-4 sm:px-6 bg-[var(--t-bg)] border-t border-[var(--t-border)]">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-[var(--t-text)] text-center tracking-tight">
              Как работает автоматизация
            </h2>
            <p className="mt-3 text-center text-sm text-[var(--t-muted)] max-w-xl mx-auto">
              Прямые ответы — без маркетинга, без жаргона.
            </p>
            <div className="mt-10">
              <FaqAccordion lang="ru" />
            </div>
          </div>
        </section>

        {/* ── CTA + contacts ── */}
        <section className="py-20 sm:py-24 px-4 sm:px-6 border-t border-[var(--t-border)] bg-[var(--t-bg)]">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-3xl sm:text-4xl font-bold text-[var(--t-text)]">
              Посмотрите на реальном примере
            </h2>
            <p className="mt-4 text-[var(--t-text-2)] text-lg">
              Прогоним продукт на реальном сценарии — увидите исполнение, а не слайды. Подтверждение — в течение одного рабочего дня.
            </p>
            <Link
              href="/connect"
              className="mt-8 inline-flex items-center justify-center px-10 py-5 bg-[var(--t-accent)] text-white font-bold rounded-xl hover:bg-[var(--t-accent-hover)] transition-all shadow-lg hover:scale-[1.02] text-lg"
            >
              Записаться на демо
            </Link>
            <p className="mt-4 text-sm text-[var(--t-muted)]">Без обязательств. Прямые ответы.</p>

            <div className="mt-10 pt-8 border-t border-[var(--t-border)]">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--t-muted)] mb-5">
                Или напишите напрямую
              </p>
              <ContactLinks />
              <p className="mt-4 text-xs text-[var(--t-muted)]">
                Пн–Пт, 9:00–18:00 МСК · обычно быстрее
              </p>
            </div>
          </div>
        </section>

      </main>

      {/* ── Footer ── */}
      <footer>
        <RuBottomQuickLinks tone="theme" />
        <div className="py-6 px-4 sm:px-6 border-t border-[var(--t-border)] bg-[var(--t-bg)]">
          <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className="text-[var(--t-text)] font-bold text-lg">ASI</span>
              <span className="text-xs text-[var(--t-muted)]">© {new Date().getFullYear()}</span>
            </div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-5 text-sm">
              <a
                href="https://t.me/ASI_core_bot"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Telegram"
                title="Telegram"
                className="flex items-center justify-center w-9 h-9 rounded-lg bg-[#2CA5E0]/10 border border-[#2CA5E0]/25 text-sky-300 hover:bg-[#2CA5E0]/20 hover:border-[#2CA5E0]/50 transition-all"
              >
                <TgIcon className="w-4 h-4" />
                <span className="sr-only">Telegram</span>
              </a>
              <a
                href={`mailto:${productSupportEmail}`}
                className="text-[var(--t-muted)] hover:text-[var(--t-text)] transition-colors break-all"
              >
                {productSupportEmail}
              </a>
            </div>
          </div>
        </div>
        <RuComplianceFooter tone="theme" />
      </footer>

    </ThemeProvider>
  );
}
