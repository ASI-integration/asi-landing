import Link from 'next/link';
import { productSupportEmail } from '@/config/contact';
import { LocationIntelligenceDemo } from '@/components/LocationIntelligenceDemo';
import { CommDemo } from '@/components/CommDemo';
import { HeroMonitor } from '@/components/HeroMonitor';
import { LocationTelemetryProvider } from '@/context/landing-location-telemetry';
import { FaqAccordion } from '@/components/FaqAccordion';

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
    desc: 'Автоматизирует общение с гостями, операции, платежи и контроль.',
  },
  {
    id: 'security',
    name: 'Автопилот безопасности',
    status: 'COMING SOON' as const,
    desc: 'Мониторинг событий, управление доступом и автоматическое реагирование на инциденты.',
  },
  {
    id: 'market',
    name: 'Автоматизация рынка',
    status: 'COMING SOON' as const,
    desc: 'Автоматизирует клиентские потоки, транзакции и операционные процессы.',
  },
];

/* ─── Cards ─────────────────────────────────────────────────────────────────── */
const CARDS = [
  {
    icon: '📥',
    title: 'Коммуникация с гостями',
    desc: 'Обрабатывает входящие запросы круглосуточно. Без задержек, без пропущенных сообщений.',
  },
  {
    icon: '📋',
    title: 'Сбор данных и приём заявок',
    desc: 'Квалифицирует лиды, собирает нужные данные и подготавливает всё до вмешательства человека.',
  },
  {
    icon: '🔄',
    title: 'Рабочие процессы и расписание',
    desc: 'Коды доступа, уборка, повторяющиеся задачи — система выполняет и закрывает их автоматически.',
  },
  {
    icon: '💳',
    title: 'Платежи и монетизация',
    desc: 'Доплаты, поздний выезд, дополнительные услуги — счёт выставляется в чате, оплата в один клик.',
  },
  {
    icon: '📊',
    title: 'Динамическое ценообразование',
    desc: 'Тарифы адаптируются к спросу, конкурентам и загрузке. Максимальный доход без ручной работы.',
  },
  {
    icon: '🔔',
    title: 'Контроль оператора по запросу',
    desc: 'Нестандартные случаи передаются оператору с полным контекстом. Всё остальное — система.',
  },
  {
    icon: '🔒',
    title: 'Безопасность и контроль доступа',
    desc: 'Мониторинг в реальном времени, контроль доступа, обнаружение инцидентов и автоматизированные сценарии реагирования.',
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
            <a href="#faq" className="hidden sm:block text-sm text-slate-400 hover:text-white transition-colors">
              Как это работает
            </a>
          </div>

          {/* Right: contacts + Telegram + Lang + Login */}
          <div className="flex items-center gap-3 sm:gap-4">
            <a
              href={`mailto:${productSupportEmail}`}
              className="hidden lg:block text-sm text-slate-400 hover:text-white transition-colors"
            >
              {productSupportEmail}
            </a>
            <span className="hidden lg:block w-px h-4 bg-slate-800" />
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
              <Link href="/" className="px-2 py-1 rounded text-slate-400 hover:text-white transition-colors">EN</Link>
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
        <section className="relative overflow-hidden bg-slate-900 py-16 sm:py-20 px-4 sm:px-6">
          <div
            className="absolute inset-0 opacity-[0.035]"
            style={{
              backgroundImage:
                'linear-gradient(rgba(255,255,255,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.15) 1px, transparent 1px)',
              backgroundSize: '60px 60px',
            }}
          />
          {/* Ambient glow */}
          <div
            className="pointer-events-none absolute -top-40 -right-40 w-[600px] h-[600px] rounded-full opacity-[0.06]"
            style={{ background: 'radial-gradient(circle, #6366f1, transparent 70%)' }}
          />

          <div className="relative max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-center">

            {/* Left: text */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500 mb-2">
                ASI — операционная инфраструктура на базе ИИ
              </p>
              <p className="text-sm text-slate-500 mb-5">
                Одна платформа. Несколько автономных систем.
              </p>
              <h1 className="text-4xl sm:text-5xl font-bold text-white tracking-tight leading-tight">
                Ваш бизнес
                <br />
                <span className="text-slate-400">работает сам.</span>
              </h1>
              <p className="mt-5 text-base font-semibold text-indigo-300 tracking-wide">
                До 99% операций без участия человека.
              </p>
              <p className="mt-4 text-lg text-slate-400 max-w-md leading-relaxed">
                ИИ-система, которая заменяет операционную работу, исполнение и контроль.
              </p>
              <p className="mt-3 text-sm text-slate-500">
                Применяется в недвижимости, гостиничном бизнесе, корпоративном жилье и распределённых операциях.
              </p>
              <p className="mt-1.5 text-sm text-slate-600">
                Создана для индивидуальных операторов и крупных портфелей.
              </p>
              <p className="mt-4 text-xs text-slate-600 tracking-wide">
                Надёжность, контроль и масштаб.
              </p>

              <div className="mt-8 flex flex-col sm:flex-row gap-3 items-start">
                <Link
                  href="/connect"
                  className="inline-flex items-center justify-center px-8 py-4 bg-white text-slate-900 font-bold rounded-xl hover:bg-slate-100 transition-all shadow-lg shadow-white/10 hover:scale-[1.02] text-base"
                >
                  Записаться на демо
                </Link>
                <a
                  href="#location-demo"
                  className="inline-flex items-center justify-center px-7 py-4 border border-slate-700 text-white font-semibold rounded-xl hover:bg-white/5 hover:border-slate-500 transition-all text-base"
                >
                  Посмотреть в действии
                </a>
              </div>

              {/* Social proof */}
              <p className="mt-6 text-sm text-slate-600">
                Решает · отвечает · исполняет · без найма персонала
              </p>
            </div>

            {/* Right: monitor */}
            <div className="w-full">
              <HeroMonitor />
            </div>
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
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-2">
              Что делает платформа
            </h2>
            <p className="text-slate-500 mb-10">
              Всё, что обычно требует операционного отдела — теперь работает автоматически.
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
        <section id="platform-modules" className="py-20 sm:py-24 px-4 sm:px-6 bg-slate-950 border-t border-slate-800/60">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-2">
              Модули платформы
            </h2>
            <p className="text-slate-500 mb-10">
              Независимые системы, единая инфраструктура.
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
              Покажем платформу в работе на реальном сценарии. Подтверждение — в течение одного рабочего дня.
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
