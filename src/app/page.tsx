import Link from 'next/link';
import { AutopilotInterfaceMock } from '@/components/AutopilotInterfaceMock';
import { FaqAccordion } from '@/components/FaqAccordion';
import { LocationIntelligenceDemo } from '@/components/LocationIntelligenceDemo';

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
    <div className="min-h-screen bg-slate-950">

      {/* ── Header ── */}
      <header className="sticky top-0 z-50 bg-slate-950/90 backdrop-blur-md border-b border-slate-800/60">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          {/* Left: brand + Who we are */}
          <div className="flex items-center gap-6">
            <Link href="/" className="text-2xl font-bold text-white tracking-tight">
              ASI
            </Link>
            <a
              href="#faq"
              className="hidden sm:block text-sm font-medium text-slate-400 hover:text-white transition-colors"
            >
              О нас
            </a>
          </div>
          {/* Right: Telegram + Contacts + Login */}
          <div className="flex items-center gap-4">
            <a
              href="https://t.me/ASI_assistant_bot"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#2CA5E0]/10 border border-[#2CA5E0]/25 text-sky-300 hover:bg-[#2CA5E0]/20 hover:border-[#2CA5E0]/50 transition-all text-sm font-semibold"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.17 13.595l-2.96-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.978.964z" />
              </svg>
              Telegram
            </a>
            <Link
              href="/contacts"
              className="hidden sm:block text-sm font-medium text-slate-400 hover:text-white transition-colors"
            >
              Контакты
            </Link>
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
              Один продукт вместо операционной команды — коммуникация с гостями,
              платежи, бронирования и контроль задач.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row sm:flex-wrap gap-4 items-start sm:items-center">
              {/* Primary CTA — largest, highest visual weight */}
              <Link
                href="/connect"
                className="inline-flex items-center justify-center px-10 py-5 bg-white text-slate-900 font-bold rounded-xl hover:bg-slate-100 transition-all shadow-lg shadow-white/10 hover:scale-[1.02] text-lg"
              >
                Записаться на демо
              </Link>
              {/* Secondary: how it works */}
              <a
                href="#faq"
                className="inline-flex items-center justify-center px-8 py-4 border border-slate-700 text-white font-semibold rounded-xl hover:bg-white/8 hover:border-slate-500 transition-all text-base"
              >
                Как это работает
              </a>
            </div>
            {/* Tertiary: interactive demo — separate row, smaller */}
            <div className="mt-4 flex flex-col gap-1 items-start">
              <Link
                href="/ops-demo"
                className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors underline underline-offset-4 decoration-slate-700 hover:decoration-slate-400"
              >
                Посмотреть, как система принимает решения
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </Link>
              <span className="text-xs text-slate-600">Интерактивный демо-режим</span>
            </div>
          </div>
        </section>

        {/* ── Location intelligence demo ── */}
        <LocationIntelligenceDemo />

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
                  className="p-6 rounded-xl border border-slate-800 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900 transition-all"
                >
                  <span className="text-3xl" aria-hidden>
                    {card.icon}
                  </span>
                  <h3 className="mt-3 font-semibold text-white">
                    {card.title}
                  </h3>
                  <p className="mt-2 text-sm text-slate-400 leading-relaxed">
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

        {/* ── Contact strip ── */}
        <section className="py-16 sm:py-20 px-4 sm:px-6 bg-slate-900/60 border-t border-slate-800/60">
          <div className="max-w-5xl mx-auto">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 mb-6 text-center">
              Связаться с нами
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-4">
              {/* Telegram */}
              <a
                href="https://t.me/ASI_assistant_bot"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-3 px-7 py-4 rounded-xl bg-[#2CA5E0]/10 border border-[#2CA5E0]/30 text-white font-semibold text-base hover:bg-[#2CA5E0]/20 hover:border-[#2CA5E0]/60 transition-all"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-[#2CA5E0] shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.17 13.595l-2.96-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.978.964z" />
                </svg>
                <span>@ASI_assistant_bot</span>
              </a>
              {/* Email */}
              <a
                href="mailto:support@asi-global.ru"
                className="inline-flex items-center justify-center gap-3 px-7 py-4 rounded-xl bg-slate-800/60 border border-slate-700 text-white font-semibold text-base hover:bg-slate-800 hover:border-slate-600 transition-all"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25H4.5a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5H4.5a2.25 2.25 0 00-2.25 2.25m19.5 0L12 13.5 2.25 6.75" />
                </svg>
                <span>support@asi-global.ru</span>
              </a>
            </div>
            <p className="mt-5 text-center text-sm text-slate-500">
              Отвечаем в течение рабочего дня (пн–пт, 9:00–18:00 МСК)
            </p>
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
              className="mt-8 inline-flex items-center justify-center px-10 py-5 bg-white text-slate-900 font-bold rounded-xl hover:bg-slate-100 transition-all shadow-lg shadow-white/10 hover:shadow-xl hover:scale-[1.02] text-lg"
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
