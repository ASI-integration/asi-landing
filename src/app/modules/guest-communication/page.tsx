import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Коммуникация с гостями | ASI',
  description:
    'Автоматизируйте общение с гостями на всех этапах — до заезда, во время проживания и после выезда. ASI отвечает быстро, опирается на данные объекта и бронирования.',
};

/* ─── Data ──────────────────────────────────────────────────────────────────── */

const PROBLEMS = [
  {
    title: 'Гости ждут ответа слишком долго',
    desc: 'ASI отвечает сразу, даже когда менеджер спит, занят или ведёт другие объекты.',
  },
  {
    title: 'Одинаковые вопросы повторяются каждый день',
    desc: 'Парковка, Wi-Fi, заезд, документы, правила, продление, поздний выезд, залог, как пройти, где ключи.',
  },
  {
    title: 'Команда устаёт от переписок 24/7',
    desc: 'Рутина уходит в систему, люди подключаются только там, где нужен реальный контроль.',
  },
  {
    title: 'Страшно отдавать общение боту',
    desc: 'ASI работает в рамках правил, сценариев и границ делегирования, а не импровизирует где попало.',
  },
];

const CAPABILITIES = [
  'отвечает на типовые вопросы гостей',
  'отправляет инструкции до заезда и после подтверждения',
  'учитывает язык общения гостя',
  'использует данные бронирования и объекта',
  'напоминает о правилах, времени выезда, оплатах и деталях проживания',
  'предлагает допуслуги и апсейлы по заданным правилам',
  'распознаёт чувствительные случаи и переводит их менеджеру',
  'сохраняет единый контекст общения',
];

const HOW_IT_WORKS = [
  {
    step: '1',
    title: 'Событие',
    desc: 'Новая бронь, вопрос гостя, приближение заезда, запрос на ранний check-in, жалоба, отзыв.',
  },
  {
    step: '2',
    title: 'Контекст',
    desc: 'ASI понимает, какой это объект, какой гость, какой этап проживания и какие правила действуют.',
  },
  {
    step: '3',
    title: 'Решение',
    desc: 'Система либо отвечает сама, либо запрашивает подтверждение, либо переводит кейс менеджеру.',
  },
  {
    step: '4',
    title: 'Действие',
    desc: 'Гость получает сообщение, а команда получает только то, что требует участия.',
  },
];

const SCENARIOS = [
  {
    label: 'До заезда',
    desc: 'Гость спрашивает, как попасть в объект, можно ли раньше заселиться, где парковка и какие документы нужны.',
  },
  {
    label: 'Во время проживания',
    desc: 'Вопросы по Wi-Fi, продлению, уборке, дополнительным принадлежностям, правилам объекта, тишине, оборудованию.',
  },
  {
    label: 'Проблемный случай',
    desc: 'Жалоба, конфликт, риск плохого отзыва, просьба о компенсации, спорная ситуация. ASI не делает опасных обещаний без разрешения и передаёт ситуацию человеку.',
  },
  {
    label: 'После выезда',
    desc: 'Благодарность, запрос на отзыв, возвратный контакт, повторное бронирование, follow-up.',
  },
];

const CHANNELS = [
  'Telegram',
  'мессенджеры',
  'web / direct flows',
  'текст',
  'голосовые сценарии как опция',
];

/* ─── Page ──────────────────────────────────────────────────────────────────── */

export default function GuestCommunicationPage() {
  return (
    <div className="min-h-screen bg-white">
      <Header />

      <main>

        {/* ── Hero ── */}
        <section className="relative py-24 sm:py-32 bg-slate-900 px-4 sm:px-6 lg:px-8 overflow-hidden">
          <div
            className="absolute inset-0 opacity-[0.04]"
            style={{
              backgroundImage:
                'linear-gradient(rgba(255,255,255,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.15) 1px, transparent 1px)',
              backgroundSize: '60px 60px',
            }}
          />
          <div className="relative max-w-5xl mx-auto">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-300 transition-colors mb-8"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
              Назад
            </Link>

            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500 mb-5">
              Модуль — Коммуникация с гостями
            </p>
            <h1 className="text-4xl sm:text-5xl font-bold text-white tracking-tight leading-tight max-w-3xl">
              Коммуникация с гостями без хаоса, ночных переписок и потери контроля
            </h1>
            <p className="mt-6 text-lg sm:text-xl text-slate-400 leading-relaxed max-w-2xl">
              ASI помогает автоматизировать общение с гостями на всех этапах: до заезда, во время
              проживания и после выезда. Система отвечает быстро, опирается на данные объекта и
              бронирования, а нестандартные ситуации передаёт человеку по заданным правилам.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row gap-4">
              <Link
                href="/connect"
                className="inline-flex items-center justify-center px-8 py-4 bg-white text-slate-900 font-semibold rounded-xl hover:bg-slate-100 transition-all shadow-lg shadow-white/10 hover:scale-[1.02] text-base"
              >
                Записаться на демо
              </Link>
              <a
                href="#how-it-works"
                className="inline-flex items-center justify-center px-8 py-4 border border-slate-700 text-white font-semibold rounded-xl hover:bg-white/8 hover:border-slate-500 transition-all text-base"
              >
                Посмотреть, как это работает
              </a>
            </div>
          </div>
        </section>

        {/* ── Problems ── */}
        <section className="py-20 sm:py-24 px-4 sm:px-6 lg:px-8 bg-slate-50">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900">
              Что решает модуль
            </h2>
            <div className="mt-10 grid sm:grid-cols-2 gap-5">
              {PROBLEMS.map((p) => (
                <div
                  key={p.title}
                  className="p-6 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition-colors"
                >
                  <h3 className="font-semibold text-slate-900">{p.title}</h3>
                  <p className="mt-2 text-sm text-slate-600 leading-relaxed">{p.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Capabilities ── */}
        <section className="py-20 sm:py-24 px-4 sm:px-6 lg:px-8 bg-white">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900">
              Что делает ASI в коммуникации с гостями
            </h2>
            <ul className="mt-10 grid sm:grid-cols-2 gap-x-10 gap-y-4">
              {CAPABILITIES.map((item) => (
                <li key={item} className="flex items-start gap-3 text-slate-700">
                  <span className="mt-1 flex-shrink-0 w-1.5 h-1.5 rounded-full bg-slate-400" />
                  <span className="text-base leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── How it works ── */}
        <section
          id="how-it-works"
          className="scroll-mt-20 py-20 sm:py-24 px-4 sm:px-6 lg:px-8 bg-slate-900"
        >
          <div className="max-w-5xl mx-auto">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500 mb-4">
              Логика работы
            </p>
            <h2 className="text-2xl sm:text-3xl font-bold text-white">
              Не магия. Понятная логика работы.
            </h2>
            <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {HOW_IT_WORKS.map((s) => (
                <div key={s.step} className="flex flex-col">
                  <span className="text-4xl font-bold text-slate-700">{s.step}</span>
                  <h3 className="mt-3 font-semibold text-white text-lg">{s.title}</h3>
                  <p className="mt-2 text-sm text-slate-400 leading-relaxed">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Scenarios ── */}
        <section className="py-20 sm:py-24 px-4 sm:px-6 lg:px-8 bg-white">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900">
              Реальные сценарии, а не абстрактный AI chat
            </h2>
            <div className="mt-10 grid sm:grid-cols-2 gap-5">
              {SCENARIOS.map((sc) => (
                <div
                  key={sc.label}
                  className="p-6 rounded-xl border border-slate-200 bg-slate-50 hover:border-slate-300 transition-colors"
                >
                  <span className="inline-block px-2.5 py-0.5 text-xs font-semibold text-slate-600 bg-slate-200 rounded-md mb-3">
                    {sc.label}
                  </span>
                  <p className="text-sm text-slate-700 leading-relaxed">{sc.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Automation boundaries ── */}
        <section className="py-20 sm:py-24 px-4 sm:px-6 lg:px-8 bg-slate-50">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900">
              Автоматизация там, где она полезна. Контроль там, где он нужен.
            </h2>
            <p className="mt-6 text-base text-slate-600 leading-relaxed">
              ASI не подменяет менеджера во всех случаях подряд. Система может работать по уровням
              делегирования: от подсказок и полуавтоматики до почти полного ведения типовой
              коммуникации. Всё, что связано с рисками, компенсациями, спорными обещаниями и
              чувствительными кейсами, может быть ограничено правилами и подтверждением человека.
            </p>
          </div>
        </section>

        {/* ── Channels ── */}
        <section className="py-20 sm:py-24 px-4 sm:px-6 lg:px-8 bg-white">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900">
              Каналы общения
            </h2>
            <ul className="mt-8 flex flex-wrap gap-3">
              {CHANNELS.map((ch) => (
                <li
                  key={ch}
                  className="px-4 py-2 rounded-full border border-slate-200 bg-slate-50 text-sm text-slate-700 font-medium"
                >
                  {ch}
                </li>
              ))}
            </ul>
            <p className="mt-6 text-sm text-slate-500">
              Каналы подключения зависят от текущего этапа внедрения и конфигурации объекта.
            </p>
          </div>
        </section>

        {/* ── CTA ── */}
        <section className="py-24 sm:py-32 px-4 sm:px-6 lg:px-8 bg-slate-900 text-center">
          <div className="max-w-xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-white">
              Покажем, как это работает на реальном сценарии
            </h2>
            <p className="mt-4 text-slate-400 leading-relaxed">
              Разберём, какие сообщения можно отдать системе, где поставить границы, и как
              уменьшить ручную нагрузку без потери качества сервиса.
            </p>
            <Link
              href="/connect"
              className="mt-8 inline-flex items-center justify-center px-10 py-4 bg-white text-slate-900 font-semibold rounded-xl hover:bg-slate-100 transition-all shadow-lg shadow-white/10 hover:shadow-xl hover:scale-[1.02]"
            >
              Записаться на демо
            </Link>
          </div>
        </section>

      </main>

      <Footer />
    </div>
  );
}
