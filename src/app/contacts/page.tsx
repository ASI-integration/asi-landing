import Link from 'next/link';
import { productSupportEmail } from '@/config/contact';
import { legalConfig } from '@/config/legal';

export const metadata = {
  title: 'Контакты и поддержка — ASI',
  description: 'Свяжитесь с командой ASI Integrations по email или через Telegram-ассистента.',
};

export default function ContactsPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Nav */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-10">
        <Link
          href="/"
          className="text-slate-500 hover:text-slate-300 text-sm transition-colors"
        >
          ← На главную
        </Link>
      </div>

      {/* Header */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 pt-14 pb-4">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
          Контакты и поддержка
        </h1>
        <p className="mt-4 text-slate-400 text-base leading-relaxed max-w-xl">
          Мы отвечаем в течение одного рабочего дня. Выберите удобный способ связи.
        </p>
      </div>

      {/* Divider */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <div className="h-px bg-slate-800 mt-8" />
      </div>

      {/* Channels */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 mt-12 grid grid-cols-1 sm:grid-cols-2 gap-6">

        {/* Email */}
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-7 flex flex-col gap-4">
          <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-5 h-5 text-slate-300"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25H4.5a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5H4.5a2.25 2.25 0 00-2.25 2.25m19.5 0L12 13.5 2.25 6.75"
              />
            </svg>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-widest mb-1">
              Email
            </p>
            <a
              href={`mailto:${productSupportEmail}`}
              className="text-xl font-semibold text-white hover:text-slate-300 transition-colors break-all"
            >
              {productSupportEmail}
            </a>
          </div>
          <p className="text-sm text-slate-400 leading-relaxed">
            Основной канал связи. Укажите в теме письма название объекта или номер аккаунта —
            это ускорит обработку запроса.
          </p>
          <a
            href={`mailto:${productSupportEmail}`}
            className="mt-auto inline-flex items-center justify-center px-5 py-3 rounded-xl bg-white text-slate-900 text-sm font-semibold hover:bg-slate-100 transition-colors"
          >
            Написать письмо
          </a>
        </div>

        {/* Telegram */}
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-7 flex flex-col gap-4">
          <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-5 h-5 text-slate-300"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12L7.17 13.595l-2.96-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.978.964z" />
            </svg>
          </div>
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-widest mb-1">
              Telegram
            </p>
            <a
              href="https://t.me/ASI_core_bot"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xl font-semibold text-white hover:text-slate-300 transition-colors"
            >
              @ASI_core_bot
            </a>
          </div>
          <p className="text-sm text-slate-400 leading-relaxed">
            ИИ-ассистент ASI отвечает круглосуточно: поможет с настройкой, ответит на вопросы
            по тарифам и передаст сложный запрос оператору.
          </p>
          <a
            href="https://t.me/ASI_core_bot"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-auto inline-flex items-center justify-center px-5 py-3 rounded-xl bg-slate-700 text-white text-sm font-semibold hover:bg-slate-600 transition-colors"
          >
            Открыть в Telegram
          </a>
        </div>
      </div>

      {/* Response time note */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 mt-8">
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-6 py-4 flex items-start gap-3">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p className="text-sm text-slate-400 leading-relaxed">
            <span className="text-slate-200 font-medium">Режим работы:</span> обработка заявок —
            в течение одного рабочего дня (пн–пт, 9:00–18:00 МСК). Это соответствует условиям{' '}
            <Link href="/offer" className="text-slate-300 hover:text-white underline underline-offset-2 transition-colors">
              публичной оферты
            </Link>
            .
          </p>
        </div>
      </div>

      {/* Divider */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <div className="h-px bg-slate-800 mt-16" />
      </div>

      {/* Legal requisites */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 mt-10 pb-20">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-widest mb-5">
          Реквизиты
        </p>
        <div className="rounded-2xl bg-slate-900 border border-slate-800 px-7 py-6 space-y-2 text-sm text-slate-400">
          <p>
            <span className="text-slate-200 font-semibold">{legalConfig.name}</span>
          </p>
          <p>Самозанятый · ИНН: <span className="text-slate-200 font-medium">{legalConfig.inn}</span></p>
          <p>г. Санкт-Петербург, Россия</p>
          <p>
            E-mail (правовые вопросы):{' '}
            <a href={`mailto:${legalConfig.email}`} className="text-slate-300 hover:text-white transition-colors">
              {legalConfig.email}
            </a>
          </p>
          <div className="pt-3 mt-3 border-t border-slate-800 flex flex-wrap gap-4 text-xs">
            <Link href="/offer" className="text-slate-500 hover:text-slate-300 transition-colors">
              Публичная оферта
            </Link>
            <Link href="/privacy" className="text-slate-500 hover:text-slate-300 transition-colors">
              Политика конфиденциальности
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
