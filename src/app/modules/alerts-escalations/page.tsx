import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Сигналы и эскалации | ASI',
  description:
    'Выявляйте отклонения вовремя: ASI фиксирует риски, отправляет сигналы по правилам и передаёт кейс человеку до того, как сбой стал проблемой.',
};

/* ─── Data ──────────────────────────────────────────────────────────────────── */

const PROBLEMS = [
  {
    title: 'Сбои замечают слишком поздно',
    desc: 'Проблема становится видна только тогда, когда гость уже недоволен, срок пропущен или процесс сорван.',
  },
  {
    title: 'Уведомлений много, но они бесполезны',
    desc: 'Когда система шлёт всё подряд, команда перестаёт различать реально важные сигналы.',
  },
  {
    title: 'Неясно, когда нужен человек',
    desc: 'Без понятных правил один кейс может повиснуть, а другой уйти в хаотичную переписку без владельца.',
  },
  {
    title: 'Отклонения не складываются в управляемый процесс',
    desc: 'Важно не просто сообщить о проблеме, а понять, что делать дальше: ждать, напомнить, ограничить следующий шаг или передать кейс человеку.',
  },
];

const CAPABILITIES = [
  'фиксирует важные отклонения и рисковые события',
  'отправляет сигналы по заданным правилам',
  'отличает обычное событие от случая, требующего внимания',
  'помогает эскалировать кейс человеку без потери контекста',
  'сохраняет историю сигналов и действий',
  'снижает вероятность тихих сбоев и пропущенных проблем',
  'помогает связать уведомление с конкретным гостем, объектом и сценарием',
  'делает реакцию на отклонения более предсказуемой и управляемой',
];

const HOW_IT_WORKS = [
  {
    step: '1',
    title: 'Сигнал',
    desc: 'Происходит событие: задача просрочена, платёж не завершён, доступ не подтверждён, сценарий заезда не дошёл до нужного статуса, возникла жалоба или другое отклонение.',
  },
  {
    step: '2',
    title: 'Контекст',
    desc: 'ASI понимает, какой это объект, гость, этап сценария и насколько критичен текущий сбой.',
  },
  {
    step: '3',
    title: 'Правило',
    desc: 'Система определяет, что делать дальше: напомнить, подождать, ограничить следующий шаг, уведомить ответственное лицо или сразу передать кейс человеку.',
  },
  {
    step: '4',
    title: 'Реакция',
    desc: 'Команда получает не просто "пинг", а понятный кейс с контекстом и причиной, почему он требует внимания именно сейчас.',
  },
];

const SCENARIOS = [
  {
    label: 'Просроченная задача',
    desc: 'Подготовка объекта или другой обязательный шаг не завершены вовремя. Система не даёт этому тихо исчезнуть и поднимает сигнал.',
  },
  {
    label: 'Платёж не получен',
    desc: 'Гостю отправили ссылку, но оплата не прошла в нужный срок. Модуль помогает вовремя включить напоминание или эскалацию.',
  },
  {
    label: 'Проблема с заездом',
    desc: 'Нужный этап не подтверждён, инструкции не доставлены или доступ не готов. Отклонение фиксируется до того, как гость оказывается у двери.',
  },
  {
    label: 'Жалоба или чувствительный кейс',
    desc: 'Если кейс выходит за рамки обычной автоматизации, система не пытается "дожать" его сама, а вовремя передаёт человеку.',
  },
];

const CONNECTIONS = [
  'коммуникация с гостем',
  'задачи и сроки',
  'статусы бронирования и проживания',
  'платежи и подтверждения',
  'доступ и контроль готовности',
  'операционные отклонения и риски',
];

/* ─── Page ──────────────────────────────────────────────────────────────────── */

export default function AlertsEscalationsPage() {
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
              Модуль — Сигналы и эскалации
            </p>
            <h1 className="text-4xl sm:text-5xl font-bold text-white tracking-tight leading-tight max-w-3xl">
              Сигналы и эскалации без потерянных сбоев, молчаливых ошибок и запоздалой реакции
            </h1>
            <p className="mt-6 text-lg sm:text-xl text-slate-400 leading-relaxed max-w-2xl">
              ASI помогает выявлять отклонения в процессе проживания и операционной работе:
              замечать, когда сценарий не завершён, платёж не прошёл, задача просрочена, доступ
              не подтверждён или возникает другой риск. Система не просто шлёт уведомления, а
              помогает вовремя перевести кейс туда, где нужно человеческое решение.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row gap-4">
              <Link
                href="/connect"
                className="inline-flex items-center justify-center px-8 py-4 bg-white text-slate-900 font-semibold rounded-xl hover:bg-slate-100 transition-all shadow-lg shadow-white/10 hover:scale-[1.02] text-base"
              >
                Записаться на демо
              </Link>
              <a
                href="#scenarios"
                className="inline-flex items-center justify-center px-8 py-4 border border-slate-700 text-white font-semibold rounded-xl hover:bg-white/8 hover:border-slate-500 transition-all text-base"
              >
                Посмотреть сценарии
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
              Что делает ASI в сигналах и эскалациях
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
        <section className="py-20 sm:py-24 px-4 sm:px-6 lg:px-8 bg-slate-900">
          <div className="max-w-5xl mx-auto">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500 mb-4">
              Логика работы
            </p>
            <h2 className="text-2xl sm:text-3xl font-bold text-white">
              Не просто уведомление, а логика реакции на отклонение
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
        <section
          id="scenarios"
          className="scroll-mt-20 py-20 sm:py-24 px-4 sm:px-6 lg:px-8 bg-white"
        >
          <div className="max-w-5xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900">
              Где модуль особенно полезен
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
              Не каждый сигнал должен кричать, но важный не должен потеряться
            </h2>
            <p className="mt-6 text-base text-slate-600 leading-relaxed">
              ASI не должен превращать всё в поток тревог. Модуль работает по заданным правилам
              приоритета: какие события являются критичными, где достаточно напоминания, где нужно
              дождаться следующего статуса, а где кейс обязан немедленно уйти человеку. Это
              помогает сохранить внимание команды к действительно важным вещам.
            </p>
          </div>
        </section>

        {/* ── Connections ── */}
        <section className="py-20 sm:py-24 px-4 sm:px-6 lg:px-8 bg-white">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900">
              С чем связан модуль
            </h2>
            <ul className="mt-8 flex flex-wrap gap-3">
              {CONNECTIONS.map((item) => (
                <li
                  key={item}
                  className="px-4 py-2 rounded-full border border-slate-200 bg-slate-50 text-sm text-slate-700 font-medium"
                >
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-6 text-sm text-slate-500">
              Глубина логики сигналов и эскалаций зависит от типа объекта, текущей конфигурации
              и этапа внедрения.
            </p>
          </div>
        </section>

        {/* ── CTA ── */}
        <section className="py-24 sm:py-32 px-4 sm:px-6 lg:px-8 bg-slate-900 text-center">
          <div className="max-w-xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-white">
              Покажем, как не терять критичные отклонения в ежедневной работе
            </h2>
            <p className="mt-4 text-slate-400 leading-relaxed">
              Разберём, какие сигналы реально важны для вашего объекта, где нужны эскалации, и
              как настроить правила так, чтобы команда видела главное, а не тонула в шуме.
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
