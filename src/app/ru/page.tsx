import Link from 'next/link';
import { productSupportEmail } from '@/config/contact';
import { LocationIntelligenceDemo } from '@/components/LocationIntelligenceDemo';
import { CommDemo } from '@/components/CommDemo';
import { LocationTelemetryProvider } from '@/context/landing-location-telemetry';
import { FaqAccordion } from '@/components/FaqAccordion';
import { HeroSection } from '@/components/HeroSection';

const DEMO_LINK = '/connect';

/* ─── Telegram SVG icon ────────────────────────────────────────────────────── */
function TgIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.17 13.595l-2.96-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.978.964z" />
    </svg>
  );
}

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

/* ─── Что автоматизируется (после hero) ─────────────────────────────────────── */
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
        className="inline-flex items-center justify-center gap-3 px-6 py-3.5 rounded-xl bg-[#2CA5E0]/10 border border-[#2CA5E0]/30 text-white font-semibold text-sm hover:bg-[#2CA5E0]/20 hover:border-[#2CA5E0]/60 transition-all"
      >
        <TgIcon />
        @ASI_core_bot
      </a>
      <a
        href={`mailto:${productSupportEmail}`}
        className="inline-flex items-center justify-center gap-3 px-6 py-3.5 rounded-xl bg-slate-800/60 border border-slate-700 text-white font-semibold text-sm hover:bg-slate-800 hover:border-slate-600 transition-all"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
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
    <LocationTelemetryProvider>
    <div className="min-h-screen bg-slate-950">

      {/* ── Header ── */}
      <header className="sticky top-0 z-50 bg-slate-950/90 backdrop-blur-md border-b border-slate-800/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-4">

          {/* Brand + nav */}
          <div className="flex items-center gap-6">
            <Link href="/ru" className="text-2xl font-bold text-white tracking-tight shrink-0">
              ASI
            </Link>
            <a href="#platform-modules" className="hidden sm:block text-sm text-slate-400 hover:text-white transition-colors">
              Платформа
            </a>
            <a href="#pricing" className="hidden sm:block text-sm text-slate-400 hover:text-white transition-colors">
              Тарифы
            </a>
            <a href="#faq" className="hidden sm:block text-sm text-slate-400 hover:text-white transition-colors">
              Как это работает
            </a>
          </div>

          {/* Right: contacts + Telegram + Lang + Login */}
          <div className="flex items-center gap-3 sm:gap-4">
            <a
              href={`mailto:${productSupportEmail}`}
              className="hidden sm:block text-sm text-slate-400 hover:text-white transition-colors truncate max-w-[11rem] md:max-w-none"
              title={productSupportEmail}
            >
              {productSupportEmail}
            </a>
            <span className="hidden sm:block w-px h-4 bg-slate-800 shrink-0" />
            <a
              href="https://t.me/ASI_core_bot"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#2CA5E0]/10 border border-[#2CA5E0]/25 text-sky-300 hover:bg-[#2CA5E0]/20 hover:border-[#2CA5E0]/50 transition-all text-sm font-semibold"
            >
              <TgIcon className="w-4 h-4 shrink-0" />
              Telegram
            </a>
            <div className="flex items-center gap-1 text-sm">
              <a href="https://asi-global.com" className="px-2 py-1 rounded text-slate-400 hover:text-white transition-colors">EN</a>
              <span className="text-slate-700">|</span>
              <span className="px-2 py-1 rounded font-semibold text-white bg-slate-800">RU</span>
            </div>
            <Link
              href="/login"
              className="inline-flex items-center justify-center px-4 py-2 bg-white text-slate-900 text-sm font-semibold rounded-lg hover:bg-slate-100 transition-colors shadow-sm"
            >
              Войти
            </Link>
          </div>
        </div>
      </header>

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
          offerHeadline: <>Ваш бизнес <span className="text-slate-300">работает сам.</span></>,
          offerSub: <>Пассивный доход от вашей недвижимости<br className="hidden sm:block" /> без операционки и найма персонала</>,
          ctaLabel: 'Записаться на демо',
          ctaHref: DEMO_LINK,
          ctaExternal: false,
        }} />

        {/* ── Feature quick-nav ── */}
        <section className="py-4 px-4 sm:px-6 bg-slate-950 border-t border-b border-slate-800/60">
          <div className="max-w-5xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {[
              { href: '#scale',            icon: '📈', label: 'От 1 до 100+ объектов' },
              { href: '#platform-modules', icon: '🔄', label: 'Синхронизация площадок' },
              { href: '#pricing',          icon: '💰', label: 'Тарифы' },
              { href: '#faq',              icon: '🤖', label: 'Как это работает' },
            ].map(({ href, icon, label }) => (
              <a
                key={href}
                href={href}
                className="group flex items-center gap-2.5 sm:gap-3 px-4 sm:px-5 py-3.5 rounded-xl border border-slate-800 bg-slate-900/60 hover:border-indigo-500/40 hover:bg-indigo-950/20 transition-all"
              >
                <span className="text-xl sm:text-2xl shrink-0">{icon}</span>
                <span className="text-xs sm:text-sm font-medium text-slate-300 group-hover:text-white transition-colors leading-snug">
                  {label}
                </span>
              </a>
            ))}
          </div>
        </section>

        {/* ── Что реально автоматизируется ── */}
        <section className="py-20 sm:py-24 px-4 sm:px-6 bg-slate-950 border-t border-slate-800/60">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3">
              Что реально автоматизируется
            </h2>
            <p className="text-slate-400 text-lg mb-10">
              Не инструменты. Не дашборды. Операции.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {AUTOMATED_ITEMS.map((item) => (
                <div
                  key={item.title}
                  className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900 transition-all"
                >
                  <h3 className="font-semibold text-white text-sm leading-snug">{item.title}</h3>
                  <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Позиционирование ── */}
        <section className="py-20 sm:py-24 px-4 sm:px-6 bg-slate-900/40 border-t border-slate-800/60">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-8">
              Не очередной инструмент
            </h2>
            <ul className="space-y-3 text-slate-400 text-base leading-relaxed">
              <li>
                <span className="text-slate-500" aria-hidden>❌ </span>
                Менеджеры каналов → всё равно нужен ручной контроль
              </li>
              <li>
                <span className="text-slate-500" aria-hidden>❌ </span>
                CRM → всё равно нужны операторы
              </li>
              <li>
                <span className="text-slate-500" aria-hidden>❌ </span>
                Точечные продукты «автоматизации» → частичное покрытие
              </li>
              <li className="pt-2 text-slate-200 font-medium">
                <span className="text-emerald-500/90" aria-hidden>✅ </span>
                ASI → заменяет операционный слой целиком
              </li>
            </ul>
          </div>
        </section>

        {/* ── Масштаб ── */}
        <section id="scale" className="scroll-mt-20 py-20 sm:py-24 px-4 sm:px-6 bg-slate-950 border-t border-slate-800/60">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3">
              Под любой масштаб
            </h2>
            <p className="text-slate-400 text-lg mb-8">
              Система растёт вместе с портфелем — без найма и без смены инструментов.
            </p>
            <div className="grid sm:grid-cols-3 gap-4">
              {[
                { scale: '1 объект',     note: 'Полная автоматизация с первого дня' },
                { scale: '10 объектов',  note: 'Работает без операционного персонала' },
                { scale: '100+ объектов', note: 'Централизованное управление через ИИ' },
              ].map(({ scale, note }) => (
                <div key={scale} className="p-5 rounded-xl border border-slate-800 bg-slate-900/60">
                  <p className="text-white font-semibold text-base">{scale}</p>
                  <p className="mt-1 text-sm text-slate-400 leading-relaxed">{note}</p>
                </div>
              ))}
            </div>
            <p className="mt-6 text-xs text-slate-600">
              Используется в недвижимости, гостиничном бизнесе, корпоративном жилье и распределённых операциях.
            </p>
          </div>
        </section>

        {/* ── Location demo ── */}
        <div id="location-demo">
          <LocationIntelligenceDemo locale="ru" />
        </div>

        {/* ── Communication demo ── */}
        <CommDemo />

        {/* ── What the platform does ── */}
        <section className="py-20 sm:py-24 px-4 sm:px-6 bg-slate-900/40 border-t border-slate-800/60">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3">
              Слой исполнения
            </h2>
            <p className="text-slate-400 text-lg mb-10">
              Работа, которая лежала на операционном отделе, — система ведёт от начала до конца.
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {CARDS.map((card) => (
                <div
                  key={card.title}
                  className="p-5 rounded-xl border border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900 transition-all"
                >
                  <span className="text-2xl" aria-hidden>{card.icon}</span>
                  <h3 className="mt-3 font-semibold text-white text-sm leading-snug">{card.title}</h3>
                  <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">{card.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Platform modules ── */}
        <section id="platform-modules" className="scroll-mt-20 py-20 sm:py-24 px-4 sm:px-6 bg-slate-950 border-t border-slate-800/60">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3">
              Модули платформы
            </h2>
            <p className="text-slate-400 text-lg mb-10">
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
                        ? 'border-indigo-500/50 bg-indigo-950/30 hover:border-indigo-400/70 hover:bg-indigo-950/40'
                        : 'border-slate-800 bg-slate-900/40 hover:border-slate-700 hover:bg-slate-900/60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-4">
                      <h3 className={`font-semibold text-sm leading-snug ${isActive ? 'text-white' : 'text-slate-400'}`}>
                        {mod.name}
                      </h3>
                      <span
                        className={`shrink-0 text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${
                          isActive
                            ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                            : 'bg-slate-800 text-slate-500 border border-slate-700'
                        }`}
                      >
                        {isActive ? 'АКТИВНО' : 'СКОРО'}
                      </span>
                    </div>
                    <p className={`text-sm leading-relaxed ${isActive ? 'text-slate-300' : 'text-slate-500'}`}>
                      {mod.desc}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* ── Тарифы ── */}
        <section id="pricing" className="scroll-mt-20 py-20 sm:py-24 px-4 sm:px-6 bg-slate-900/40 border-t border-slate-800/60">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3">
              Тарифы
            </h2>
            <p className="text-slate-400 text-lg leading-relaxed mb-2">
              Фиксированная стоимость. Без расширения штата.
            </p>
            <p className="text-slate-500 text-sm mb-10">
              Коммуникация с гостями, платежи, бронирования и контроль задач — без найма. Цена за 1 объект в месяц.
            </p>
            <div className="grid sm:grid-cols-3 gap-6">

              {/* Small */}
              <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900 transition-all flex flex-col">
                <span className="inline-block self-start px-3 py-1 bg-emerald-500/10 text-emerald-400 text-xs font-medium rounded-full border border-emerald-500/20">
                  🟢 Small (1–3 объекта)
                </span>
                <p className="mt-4 text-xl font-semibold text-white">
                  12 900 ₽<span className="text-sm font-normal text-slate-400"> / объект / месяц</span>
                </p>
                <ul className="mt-4 space-y-2 text-slate-400 text-sm flex-1">
                  <li>✓ Полный доступ к системе</li>
                  <li>✓ Коммуникация с гостями 24/7</li>
                  <li>✓ Управление бронированиями</li>
                  <li>✓ Динамическое ценообразование</li>
                  <li>✓ Поддержка через Telegram</li>
                </ul>
                <Link
                  href="/connect"
                  className="mt-6 block text-center py-3.5 rounded-xl font-semibold border border-slate-600 text-slate-200 hover:bg-slate-800 hover:border-slate-500 transition-all text-sm"
                >
                  Записаться на демо
                </Link>
              </div>

              {/* Growth */}
              <div className="p-6 rounded-xl border border-indigo-500/50 bg-indigo-950/30 hover:border-indigo-400/70 hover:bg-indigo-950/40 transition-all flex flex-col">
                <span className="inline-block self-start px-3 py-1 bg-amber-500/10 text-amber-400 text-xs font-medium rounded-full border border-amber-500/20">
                  🟡 Growth (4–10 объектов)
                </span>
                <p className="mt-4 text-xl font-semibold text-white">
                  8 900 ₽<span className="text-sm font-normal text-slate-300"> / объект / месяц</span>
                </p>
                <ul className="mt-4 space-y-2 text-slate-300 text-sm flex-1">
                  <li>✓ Всё из Small</li>
                  <li>✓ Управление портфелем объектов</li>
                  <li>✓ Синхронизация каналов</li>
                  <li>✓ Аналитика и отчётность</li>
                  <li>✓ Приоритетная поддержка</li>
                </ul>
                <Link
                  href="/connect"
                  className="mt-6 block text-center py-3.5 rounded-xl font-semibold bg-white text-slate-900 hover:bg-slate-100 transition-all text-sm shadow-lg shadow-white/10"
                >
                  Записаться на демо
                </Link>
              </div>

              {/* Enterprise */}
              <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900 transition-all flex flex-col">
                <span className="inline-block self-start px-3 py-1 bg-blue-500/10 text-blue-400 text-xs font-medium rounded-full border border-blue-500/20">
                  🔵 Enterprise (10+ объектов)
                </span>
                <p className="mt-4 text-xl font-semibold text-white">
                  Индивидуальные условия
                </p>
                <ul className="mt-4 space-y-2 text-slate-400 text-sm flex-1">
                  <li>✓ Всё из Growth</li>
                  <li>✓ Индивидуальный объём и тарифы</li>
                  <li>✓ Договор с юрлицом</li>
                  <li>✓ Выделенная поддержка</li>
                </ul>
                <a
                  href={`mailto:${productSupportEmail}?subject=${encodeURIComponent('Enterprise — индивидуальные условия')}`}
                  className="mt-6 block text-center py-3.5 rounded-xl font-semibold border border-slate-600 text-slate-200 hover:bg-slate-800 hover:border-slate-500 transition-all text-sm"
                >
                  Связаться — индивидуальные условия
                </a>
              </div>

            </div>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section id="faq" className="scroll-mt-20 py-20 sm:py-24 px-4 sm:px-6 bg-slate-950 border-t border-slate-800/60">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-white text-center tracking-tight">
              Как работает автоматизация
            </h2>
            <p className="mt-3 text-center text-sm text-slate-500 max-w-xl mx-auto">
              Прямые ответы — без маркетинга, без жаргона.
            </p>
            <div className="mt-10">
              <FaqAccordion lang="ru" />
            </div>
          </div>
        </section>

        {/* ── CTA + contacts ── */}
        <section className="py-20 sm:py-24 px-4 sm:px-6 border-t border-slate-800/60">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-3xl sm:text-4xl font-bold text-white">
              Посмотрите на реальном примере
            </h2>
            <p className="mt-4 text-slate-400 text-lg">
              Прогоним продукт на реальном сценарии — увидите исполнение, а не слайды. Подтверждение — в течение одного рабочего дня.
            </p>
            <Link
              href="/connect"
              className="mt-8 inline-flex items-center justify-center px-10 py-5 bg-white text-slate-900 font-bold rounded-xl hover:bg-slate-100 transition-all shadow-lg shadow-white/10 hover:scale-[1.02] text-lg"
            >
              Записаться на демо
            </Link>
            <p className="mt-4 text-sm text-slate-600">Без обязательств. Прямые ответы.</p>

            {/* Contacts below CTA */}
            <div className="mt-10 pt-8 border-t border-slate-800/60">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-600 mb-5">
                Или напишите напрямую
              </p>
              <ContactLinks />
              <p className="mt-4 text-xs text-slate-600">
                Пн–Пт, 9:00–18:00 МСК · обычно быстрее
              </p>
            </div>
          </div>
        </section>

      </main>

      {/* ── Footer ── */}
      <footer className="py-8 px-4 sm:px-6 border-t border-slate-800/60 bg-slate-950">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-4">
            <span className="text-white font-bold text-lg">ASI</span>
            <span className="text-xs text-slate-600">© {new Date().getFullYear()}</span>
          </div>

          {/* Contacts in footer */}
          <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-5 text-sm">
            <a
              href="https://t.me/ASI_core_bot"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-slate-400 hover:text-sky-300 transition-colors"
            >
              <TgIcon className="w-4 h-4" />
              @ASI_core_bot
            </a>
            <span className="hidden sm:block w-px h-3 bg-slate-800" />
            <a
              href={`mailto:${productSupportEmail}`}
              className="text-slate-400 hover:text-white transition-colors"
            >
              {productSupportEmail}
            </a>
          </div>

          <div className="flex flex-wrap justify-center gap-x-5 gap-y-1">
            <Link href="/privacy" className="text-slate-600 hover:text-slate-400 text-xs">Конфиденциальность</Link>
            <Link href="/offer" className="text-slate-600 hover:text-slate-400 text-xs">Условия</Link>
            <Link href="/legal" className="text-slate-600 hover:text-slate-400 text-xs">Правовые документы</Link>
          </div>
        </div>
      </footer>

    </div>
    </LocationTelemetryProvider>
  );
}
