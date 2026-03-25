import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Операционная автоматизация | ASI',
  description:
    'Запускайте задачи по событиям, отслеживайте статусы, учитывайте сроки и правила. ASI снижает хаос в ежедневной работе и делает операционный процесс предсказуемее.',
};

/* ─── Data ──────────────────────────────────────────────────────────────────── */

const PROBLEMS = [
  {
    title: 'Задачи запускаются слишком поздно',
    desc: 'Уборка, подготовка, проверка, доступ, напоминания и другие действия часто стартуют не тогда, когда нужно, а когда кто-то вспомнил.',
  },
  {
    title: 'Процесс держится на людской памяти',
    desc: 'Команда помнит важные шаги "в голове", а не в системе. Это делает операционный контур хрупким и зависимым от конкретного человека.',
  },
  {
    title: 'Отклонения всплывают в последний момент',
    desc: 'Если задача не выполнена, срок пропущен или условие не соблюдено, проблема становится заметной только тогда, когда уже поздно.',
  },
  {
    title: 'Автоматизация без правил опасна',
    desc: 'Нельзя просто включить автопилот на всё подряд. Нужны границы: что можно запускать автоматически, что требует подтверждения, а что должно сразу эскалироваться.',
  },
];

const CAPABILITIES = [
  'запускает задачи по событиям и времени',
  'фиксирует статусы выполнения и контрольные точки',
  'помогает координировать связанные шаги в одном сценарии',
  'учитывает правила объекта и ограничения процесса',
  'отслеживает просрочки и отклонения',
  'переводит кейс человеку, если сценарий остановился или требует решения',
  'сохраняет историю действий и статусов',
  'снижает зависимость от ручных напоминаний и хаотичной координации',
];

const HOW_IT_WORKS = [
  {
    step: '1',
    title: 'Событие',
    desc: 'Возникает основание для действия: новая бронь, приближение заезда, завершение проживания, проблема в объекте, изменение статуса или наступление нужного времени.',
  },
  {
    step: '2',
    title: 'Правило',
    desc: 'ASI понимает, какой сценарий должен сработать, какие условия обязательны и где есть ограничения или контрольные точки.',
  },
  {
    step: '3',
    title: 'Задача',
    desc: 'Система запускает нужное действие или набор шагов, отслеживает статус и понимает, что должно произойти дальше.',
  },
  {
    step: '4',
    title: 'Результат',
    desc: 'Если всё прошло по плану, сценарий движется дальше. Если нет, система напоминает, останавливает цепочку или передаёт кейс человеку.',
  },
];

const SCENARIOS = [
  {
    label: 'Подготовка объекта к заезду',
    desc: 'Можно связать уборку, проверку готовности, подтверждение доступа и другие подготовительные шаги в один понятный сценарий.',
  },
  {
    label: 'Операционные отклонения',
    desc: 'Если что-то не выполнено вовремя, модуль не молчит: фиксирует отклонение, запускает эскалацию и не даёт процессу потеряться.',
  },
  {
    label: 'Продление и смена статусов',
    desc: 'Когда гость продлевает проживание или меняется состояние объекта, система может запускать следующий набор действий без ручной сборки процесса заново.',
  },
  {
    label: 'Выезд и пост-обработка',
    desc: 'После завершения проживания модуль может запускать выездные шаги, контроль статуса объекта и подготовку к следующему циклу.',
  },
];

const CONNECTIONS = [
  'сценарии заезда и выезда',
  'статусы бронирования и проживания',
  'операционные задачи внутри объекта',
  'коммуникация с гостем',
  'контроль доступа и готовности',
  'эскалации и отклонения',
];

/* ─── Page ──────────────────────────────────────────────────────────────────── */

export default function OperationsAutomationPage() {
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
              Модуль — Операционная автоматизация
            </p>
            <h1 className="text-4xl sm:text-5xl font-bold text-white tracking-tight leading-tight max-w-3xl">
              Операционная автоматизация без ручной суеты, потерянных задач и сбоев в процессе
            </h1>
            <p className="mt-6 text-lg sm:text-xl text-slate-400 leading-relaxed max-w-2xl">
              ASI помогает выстроить операционный слой вокруг объекта: запускать задачи по
              событиям, отслеживать статусы, учитывать сроки и правила, а при отклонениях вовремя
              переводить кейс человеку. Это снижает хаос в ежедневной работе и делает процесс
              предсказуемее.
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
              Что делает ASI в операционной автоматизации
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
              Процесс живёт по правилам, а не по случайным напоминаниям
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
              Где это особенно полезно
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
              Автоматизация там, где логика ясна
            </h2>
            <p className="mt-6 text-base text-slate-600 leading-relaxed">
              ASI не должен бесконтрольно запускать любые действия без рамок. Модуль работает по
              правилам: какие шаги разрешены автоматически, где нужны подтверждения, какие
              отклонения допустимы, а где сценарий обязан остановиться и перейти к человеку. Это
              делает автоматизацию управляемой, а не хаотичной.
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
              Глубина автоматизации зависит от типа объекта, текущей конфигурации и этапа
              внедрения.
            </p>
          </div>
        </section>

        {/* ── CTA ── */}
        <section className="py-24 sm:py-32 px-4 sm:px-6 lg:px-8 bg-slate-900 text-center">
          <div className="max-w-xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-white">
              Покажем, как убрать ручную суету из операционного процесса
            </h2>
            <p className="mt-4 text-slate-400 leading-relaxed">
              Разберём, какие действия можно запускать автоматически уже сейчас, где нужны
              контрольные точки, и как выстроить предсказуемую операционную логику без перегруза
              команды.
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
