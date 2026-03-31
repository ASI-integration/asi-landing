import Link from 'next/link';
import { LocationIntelligenceDemo } from '@/components/LocationIntelligenceDemo';
import { CommDemo } from '@/components/CommDemo';
import { HeroMonitor } from '@/components/HeroMonitor';
import { FaqAccordion } from '@/components/FaqAccordion';
/* ─── Telegram SVG icon ────────────────────────────────────────────────────── */
function TgIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.17 13.595l-2.96-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.978.964z" />
    </svg>
  );
}

/* ─── Cards ─────────────────────────────────────────────────────────────────── */
const CARDS = [
  {
    icon: '📥',
    title: 'Сама принимает входящие',
    desc: 'Отвечает на запросы гостей в любое время суток. Без задержки, без пропущенных сообщений.',
  },
  {
    icon: '📋',
    title: 'Сама собирает данные',
    desc: 'Уточняет даты, количество гостей, пожелания. Всё, что нужно для заезда, — система спрашивает сама.',
  },
  {
    icon: '🔄',
    title: 'Сама ведёт рутину',
    desc: 'Коды доступа, клининг, мелкие вопросы — система обрабатывает сама и закрывает задачи.',
  },
  {
    icon: '💳',
    title: 'Сама выставляет счёт',
    desc: 'Доплаты за поздний выезд и дополнительные услуги — счёт в чате, оплата в один клик.',
  },
  {
    icon: '📊',
    title: 'Сама обновляет цены',
    desc: 'Тариф меняется под спрос, конкурентов и загрузку. Максимальная выручка — без ручной работы.',
  },
  {
    icon: '🔔',
    title: 'Человеку — только контроль',
    desc: 'Нестандартные ситуации передаются оператору с готовым контекстом. Остальное — система берёт сама.',
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
        href="mailto:support@asi-global.ru"
        className="inline-flex items-center justify-center gap-3 px-6 py-3.5 rounded-xl bg-slate-800/60 border border-slate-700 text-white font-semibold text-sm hover:bg-slate-800 hover:border-slate-600 transition-all"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25H4.5a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5H4.5a2.25 2.25 0 00-2.25 2.25m19.5 0L12 13.5 2.25 6.75" />
        </svg>
        support@asi-global.ru
      </a>
    </div>
  );
}

/* ─── Page ──────────────────────────────────────────────────────────────────── */
export default function Home() {
  return (
    <div className="min-h-screen bg-slate-950">

      {/* ── Header ── */}
      <header className="sticky top-0 z-50 bg-slate-950/90 backdrop-blur-md border-b border-slate-800/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-4">

          {/* Brand + nav */}
          <div className="flex items-center gap-6">
            <Link href="/" className="text-2xl font-bold text-white tracking-tight shrink-0">
              ASI
            </Link>
            <a href="#faq" className="hidden sm:block text-sm text-slate-400 hover:text-white transition-colors">
              Как работает
            </a>
          </div>

          {/* Right: contacts visible + Telegram + Login */}
          <div className="flex items-center gap-3 sm:gap-4">
            {/* Inline contacts — visible on desktop */}
            <a
              href="mailto:support@asi-global.ru"
              className="hidden lg:block text-sm text-slate-400 hover:text-white transition-colors"
            >
              support@asi-global.ru
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
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500 mb-5">
                ASI — система управления краткосрочной арендой
              </p>
              <h1 className="text-4xl sm:text-5xl font-bold text-white tracking-tight leading-tight">
                Цифровой управляющий,
                <br />
                <span className="text-slate-400">который работает за вас.</span>
              </h1>
              <p className="mt-6 text-lg text-slate-400 max-w-md leading-relaxed">
                Автоматизирует до 99% рутины в краткосрочной аренде — от входящих запросов до управления объектом.
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
                  Смотреть в деле
                </a>
              </div>

              {/* Social proof */}
              <p className="mt-6 text-sm text-slate-600">
                Принимает решения · отвечает гостям · ведёт объект · не требует найма
              </p>
            </div>

            {/* Right: monitor — prominently large */}
            <div className="w-full">
              <HeroMonitor />
            </div>
          </div>
        </section>

        {/* ── Location demo ── */}
        <div id="location-demo">
          <LocationIntelligenceDemo />
        </div>

        {/* ── Communication demo ── */}
        <CommDemo />

        {/* ── What the platform does ── */}
        <section className="py-20 sm:py-24 px-4 sm:px-6 bg-slate-900/40 border-t border-slate-800/60">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-2">
              Что делает система
            </h2>
            <p className="text-slate-500 mb-10">
              Всё, что обычно требует операционной команды — теперь работает само.
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

        {/* ── FAQ ── */}
        <section id="faq" className="scroll-mt-20 py-20 sm:py-24 px-4 sm:px-6 bg-slate-950 border-t border-slate-800/60">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-white text-center tracking-tight">
              Как работает автоматизация
            </h2>
            <p className="mt-3 text-center text-sm text-slate-500 max-w-xl mx-auto">
              Коротко и по делу — без маркетинга и технического языка.
            </p>
            <div className="mt-10">
              <FaqAccordion />
            </div>
          </div>
        </section>

        {/* ── CTA + contacts ── */}
        <section className="py-20 sm:py-24 px-4 sm:px-6 border-t border-slate-800/60">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-3xl sm:text-4xl font-bold text-white">
              Подключиться или получить оценку объекта
            </h2>
            <p className="mt-4 text-slate-400 text-lg">
              Покажем платформу в работе на реальном объекте. Подтвердим в течение рабочего дня.
            </p>
            <Link
              href="/connect"
              className="mt-8 inline-flex items-center justify-center px-10 py-5 bg-white text-slate-900 font-bold rounded-xl hover:bg-slate-100 transition-all shadow-lg shadow-white/10 hover:scale-[1.02] text-lg"
            >
              Записаться на демо
            </Link>
            <p className="mt-4 text-sm text-slate-600">Без обязательств. Ответим честно.</p>

            {/* Contacts below CTA */}
            <div className="mt-10 pt-8 border-t border-slate-800/60">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-600 mb-5">
                Или напишите напрямую
              </p>
              <ContactLinks />
              <p className="mt-4 text-xs text-slate-600">
                Пн–Пт, 9:00–18:00 МСК · обычно отвечаем быстрее
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

          {/* Contacts in footer — always visible */}
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
              href="mailto:support@asi-global.ru"
              className="text-slate-400 hover:text-white transition-colors"
            >
              support@asi-global.ru
            </a>
          </div>

          <div className="flex flex-wrap justify-center gap-x-5 gap-y-1">
            <Link href="/privacy" className="text-slate-600 hover:text-slate-400 text-xs">Политика</Link>
            <Link href="/offer" className="text-slate-600 hover:text-slate-400 text-xs">Оферта</Link>
            <Link href="/legal" className="text-slate-600 hover:text-slate-400 text-xs">Реквизиты</Link>
          </div>
        </div>
      </footer>

    </div>
  );
}
