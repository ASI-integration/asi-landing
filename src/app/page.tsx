import Link from 'next/link';
import { AutopilotInterfaceMock } from '@/components/AutopilotInterfaceMock';
import { FaqAccordion } from '@/components/FaqAccordion';

/* ─── Strength cards data ──────────────────────────────────────────────────── */
const CARDS = [
  {
    icon: '💬',
    title: 'Коммуникация с гостями',
    desc: 'Автоматические ответы на запросы 24/7 — заезд, коды доступа, вопросы и жалобы.',
  },
  {
    icon: '💳',
    title: 'Сбор платежей',
    desc: 'Доплаты за поздний выезд и доп. услуги собираются прямо в диалоге с гостем.',
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
    <div className="min-h-screen bg-white">

      {/* ── Header ── */}
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-slate-200/60">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <Link href="/" className="text-2xl font-bold text-slate-900 tracking-tight">
            ASI
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-sm font-medium text-slate-600 hover:text-slate-900 transition-colors"
            >
              Войти
            </Link>
            <Link
              href="/connect"
              className="inline-flex items-center justify-center px-4 py-2 bg-slate-900 text-white text-sm font-semibold rounded-lg hover:bg-slate-800 transition-colors shadow-sm"
            >
              Подключиться
            </Link>
          </div>
        </div>
      </header>

      <main>

        {/* ── Hero ── */}
        <section className="relative overflow-hidden bg-slate-900 py-24 sm:py-32 px-4 sm:px-6">
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
              ASI — Система управления недвижимостью
            </p>
            <h1 className="text-5xl sm:text-7xl lg:text-display font-bold text-white tracking-tight leading-none">
              Объект
              <br />
              <span className="text-slate-400">недвижимости.</span>
              <br />
              На автопилоте.
            </h1>
            <p className="mt-8 text-lg sm:text-xl text-slate-400 max-w-xl leading-relaxed">
              Единая система, которая заменяет целый штат сотрудников. От общения
              с гостями до умного ценообразования и контроля уборок — ASI
              работает, пока вы масштабируете бизнес.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row gap-4">
              <Link
                href="/connect"
                className="inline-flex items-center justify-center px-8 py-4 bg-white text-slate-900 font-semibold rounded-xl hover:bg-slate-100 transition-all shadow-lg shadow-white/10 hover:scale-[1.02] text-base"
              >
                Подключиться
              </Link>
              <Link
                href="#faq"
                className="inline-flex items-center justify-center px-8 py-4 border border-slate-700 text-white font-semibold rounded-xl hover:bg-white/8 hover:border-slate-500 transition-all text-base"
              >
                Разобрать сомнения
              </Link>
            </div>
          </div>
        </section>

        {/* ── Strength cards ── */}
        <section className="py-20 px-4 sm:px-6">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">
              Что делает платформа
            </h2>
            <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {CARDS.map((card) => (
                <div
                  key={card.title}
                  className="p-6 rounded-xl border border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm transition-all"
                >
                  <span className="text-3xl" aria-hidden>
                    {card.icon}
                  </span>
                  <h3 className="mt-3 font-semibold text-slate-900">
                    {card.title}
                  </h3>
                  <p className="mt-2 text-sm text-slate-600 leading-relaxed">
                    {card.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Autopilot UI mock ── */}
        <AutopilotInterfaceMock />

        {/* ── FAQ ── */}
        <section id="faq" className="scroll-mt-20 py-20 px-4 sm:px-6 bg-slate-950">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-white text-center tracking-tight">
              Разбираем сомнения
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
        <section className="py-24 px-4 sm:px-6 text-center">
          <div className="max-w-xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900">
              Подключение и демо
            </h2>
            <p className="mt-4 text-slate-600">
              Оставьте контакты — покажем платформу в работе на реальном объекте
              и поможем настроить систему под вашу задачу.
            </p>
            <Link
              href="/connect"
              className="mt-8 inline-flex items-center justify-center px-10 py-4 bg-slate-900 text-white font-semibold rounded-xl hover:bg-slate-800 transition-all shadow-lg shadow-slate-900/20 hover:shadow-xl hover:scale-[1.02]"
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
