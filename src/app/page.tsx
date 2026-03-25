import Link from 'next/link';
import { AutopilotInterfaceMock } from '@/components/AutopilotInterfaceMock';
import { FaqAccordion } from '@/components/FaqAccordion';

/* ─── Strength cards data ──────────────────────────────────────────────────── */
type Card = {
  icon: string;
  title: string;
  desc: string;
  badge?: string;
  bullets?: string[];
  href?: string;
};

const CARDS: Card[] = [
  {
    icon: '💬',
    title: 'Коммуникация с гостями',
    badge: 'RU / EN · Text / Voice',
    desc: 'Не просто автоответчик. ASI ведёт диалог с учётом бронирования, этапа проживания и правил объекта, чтобы гости получали быстрые ответы, а команда не тонула в сообщениях.',
    bullets: [
      'Ответы на типовые вопросы без участия менеджера',
      'Контекст по бронированию, заезду, правилам и услугам',
      'Передача сложных случаев человеку, когда это действительно нужно',
    ],
    href: '/modules/guest-communication',
  },
  {
    icon: '💳',
    title: 'Сбор платежей',
    badge: 'ЮKassa · Ссылка / QR · По сценарию',
    desc: 'Доплаты за ранний или поздний заезд, продление, штрафы в рамках правил объекта и дополнительные услуги можно собирать прямо в логике проживания, без ручной гонки за оплатой.',
    bullets: [
      'Оплата по ссылке или QR в нужный момент сценария',
      'Привязка платежа к гостю, бронированию и услуге',
      'Контроль статуса: ожидается, оплачено, просрочено, передано менеджеру',
    ],
    href: '/modules/payments-collection',
  },
  {
    icon: '📅',
    title: 'Управление бронированиями',
    desc: 'Синхронизация календарей, контроль заездов и выездов, window-доступ к объекту.',
  },
  {
    icon: '⚙️',
    title: 'Операционный контроль',
    desc: 'Задачи на уборку и техобслуживание ставятся и закрываются без участия управляющего.',
  },
  {
    icon: '📊',
    title: 'Динамическое ценообразование',
    desc: 'Тарифы обновляются автоматически на основе спроса, конкурентов и алгоритмов OTA.',
  },
  {
    icon: '🔔',
    title: 'Эскалация и контроль',
    desc: 'Нестандартные ситуации немедленно передаются оператору с полным контекстом.',
  },
];

/* ─── Page ──────────────────────────────────────────────────────────────────── */
export default function Home() {
  return (
    <div className="min-h-screen bg-slate-950">

      {/* ── Header ── */}
      <header className="sticky top-0 z-50 bg-slate-950/90 backdrop-blur-md border-b border-slate-800/60">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link href="/" className="text-2xl font-bold text-white tracking-tight">
            ASI
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm font-medium text-slate-400 hover:text-white transition-colors"
            >
              Войти
            </Link>
            <Link
              href="/connect"
              className="inline-flex items-center justify-center px-4 py-2 bg-white text-slate-900 text-sm font-semibold rounded-lg hover:bg-slate-100 transition-colors shadow-sm"
            >
              Подключиться
            </Link>
          </div>
        </div>
      </header>

      <main>

        {/* ── Hero ── */}
        <section className="relative overflow-hidden bg-slate-900 py-28 sm:py-36 px-4 sm:px-6">
          <div
            className="absolute inset-0 opacity-[0.04]"
            style={{
              backgroundImage:
                'linear-gradient(rgba(255,255,255,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.15) 1px, transparent 1px)',
              backgroundSize: '60px 60px',
            }}
          />
          <div className="relative max-w-5xl mx-auto">
            {/* Swiss-school: left-aligned, massive, confident */}
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500 mb-6">
              ASI — Система краткосрочного управления недвижимостью
            </p>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white tracking-tight leading-tight">
              Ваши объекты недвижимости или отели
              <br />
              <span className="text-slate-400">на полном автопилоте.</span>
            </h1>
            <p className="mt-8 text-lg sm:text-xl text-slate-400 max-w-xl leading-relaxed">
              Среди прочего, заменяем ваш операционный персонал одной нашей системой.
              Автоматизируем весь процесс краткосрочной аренды целиком.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row gap-4">
              <a
                href="#faq"
                className="inline-flex items-center justify-center px-8 py-4 bg-white text-slate-900 font-semibold rounded-xl hover:bg-slate-100 transition-all shadow-lg shadow-white/10 hover:scale-[1.02] text-base"
              >
                Как это работает
              </a>
              <Link
                href="/connect"
                className="inline-flex items-center justify-center px-8 py-4 border border-slate-700 text-white font-semibold rounded-xl hover:bg-white/8 hover:border-slate-500 transition-all text-base"
              >
                Подключиться
              </Link>
            </div>
          </div>
        </section>

        {/* ── Strength cards ── */}
        <section className="py-28 sm:py-32 px-4 sm:px-6">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-white">
              Что делает платформа
            </h2>
            <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {CARDS.map((card) => (
                <div
                  key={card.title}
                  className="p-6 rounded-xl border border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900 transition-all flex flex-col"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-3xl" aria-hidden>
                      {card.icon}
                    </span>
                    {card.badge && (
                      <span className="flex-shrink-0 px-2 py-0.5 text-xs font-medium text-slate-400 bg-slate-800 border border-slate-700 rounded-md whitespace-nowrap">
                        {card.badge}
                      </span>
                    )}
                  </div>
                  <h3 className="mt-3 font-semibold text-white">
                    {card.title}
                  </h3>
                  <p className="mt-2 text-sm text-slate-400 leading-relaxed">
                    {card.desc}
                  </p>
                  {card.bullets && (
                    <ul className="mt-3 space-y-1.5">
                      {card.bullets.map((b) => (
                        <li key={b} className="flex items-start gap-2 text-xs text-slate-500">
                          <span className="mt-0.5 text-slate-600 flex-shrink-0">—</span>
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {card.href && (
                    <div className="mt-4 pt-3 border-t border-slate-800">
                      <Link
                        href={card.href}
                        className="inline-flex items-center gap-1 text-xs font-medium text-slate-300 hover:text-white transition-colors"
                      >
                        Подробнее
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </Link>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Autopilot UI mock ── */}
        <AutopilotInterfaceMock />

        {/* ── FAQ ── */}
        <section id="faq" className="scroll-mt-20 py-28 sm:py-32 px-4 sm:px-6 bg-slate-950 border-t border-slate-800/60">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-white text-center tracking-tight">
              Как работает автоматизация
            </h2>
            <p className="mt-3 text-center text-sm text-slate-500 max-w-xl mx-auto">
              Автоматизация, безопасность данных и формат работы с бизнесом — коротко и по делу.
            </p>
            <div className="mt-10">
              <FaqAccordion />
            </div>
          </div>
        </section>

        {/* ── CTA ── */}
        <section className="py-28 sm:py-32 px-4 sm:px-6 text-center">
          <div className="max-w-xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-white">
              Подключение и демо
            </h2>
            <p className="mt-4 text-slate-400">
              Оставьте контакты — покажем платформу в работе на реальном объекте
              и поможем настроить систему под вашу задачу.
            </p>
            <Link
              href="/connect"
              className="mt-8 inline-flex items-center justify-center px-10 py-4 bg-white text-slate-900 font-semibold rounded-xl hover:bg-slate-100 transition-all shadow-lg shadow-white/10 hover:shadow-xl hover:scale-[1.02]"
            >
              Записаться на демо
            </Link>
            <p className="mt-4 text-sm text-slate-500">
              Подтвердим подключение в течение рабочего дня.
            </p>
          </div>
        </section>

      </main>

    </div>
  );
}
