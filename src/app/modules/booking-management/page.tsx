import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Управление бронированиями | ASI',
  description:
    'Выстройте управляемый процесс вокруг бронирования: от подтверждения и подготовки объекта до заезда, проживания, продления и выезда.',
};

/* ─── Data ──────────────────────────────────────────────────────────────────── */

const PROBLEMS = [
  {
    title: 'Бронирование есть, но процесс вокруг него разваливается',
    desc: 'Подтверждение прошло, но дальше начинаются ручные напоминания, потерянные сообщения и несогласованные действия.',
  },
  {
    title: 'Заезды и выезды требуют постоянного контроля',
    desc: 'Нужно помнить про время, инструкции, доступ, готовность объекта, правила и исключения по каждому кейсу.',
  },
  {
    title: 'Статусы живут в голове менеджера',
    desc: 'Кто подтвердил, кто заехал, кому отправили инструкции, где нужен контроль, а где уже всё выполнено, часто видно только одному человеку.',
  },
  {
    title: 'Ошибки всплывают в последний момент',
    desc: 'Если сценарии не запускаются вовремя, команда узнаёт о проблеме слишком поздно: когда гость уже у двери, уборка не завершена или доступ ещё не готов.',
  },
];

const CAPABILITIES = [
  'фиксирует ключевые этапы бронирования и проживания',
  'запускает нужные сценарии по событиям и времени',
  'помогает координировать заезд, проживание, продление и выезд',
  'учитывает правила объекта, окна доступа и ограничения',
  'связывает действия с конкретным гостем и объектом',
  'снижает количество ручных напоминаний и пропущенных шагов',
  'помогает видеть статус процесса, а не только факт брони',
  'передаёт кейс человеку, если сценарий требует подтверждения или возникло отклонение',
];

const HOW_IT_WORKS = [
  {
    step: '1',
    title: 'Событие',
    desc: 'Появляется новая бронь, меняется статус, приближается заезд, гость просит продление или начинается выездной сценарий.',
  },
  {
    step: '2',
    title: 'Контекст',
    desc: 'ASI понимает объект, гостя, время, правила, связанные ограничения и нужные действия на текущем этапе.',
  },
  {
    step: '3',
    title: 'Сценарий',
    desc: 'Система запускает нужную логику: инструкции, контроль готовности, допуск к следующему шагу, напоминание, эскалацию или ожидание подтверждения.',
  },
  {
    step: '4',
    title: 'Результат',
    desc: 'Команда видит, что должно произойти дальше, а гость проходит путь проживания без лишнего хаоса и провалов в процессе.',
  },
];

const SCENARIOS = [
  {
    label: 'Подтверждение бронирования',
    desc: 'После появления брони система может запускать нужный базовый сценарий: проверку данных, подготовительные шаги и дальнейшую коммуникацию.',
  },
  {
    label: 'Подготовка к заезду',
    desc: 'ASI помогает вовремя запустить инструкции, учесть время прибытия, ограничения объекта и необходимые условия перед заселением.',
  },
  {
    label: 'Продление проживания',
    desc: 'Если гость хочет остаться дольше, модуль помогает провести кейс через проверку, согласование, обновление статуса и следующий этап сценария.',
  },
  {
    label: 'Выезд',
    desc: 'Система может запускать выездные шаги, напоминания, контроль завершения проживания и передачу следующего статуса в операционный контур.',
  },
];

const CONNECTIONS = [
  'календарь и статусы бронирования',
  'сценарии заезда и выезда',
  'правила доступа к объекту',
  'коммуникацию с гостем',
  'внутренние операционные шаги',
  'контроль отклонений и эскалаций',
];

/* ─── Page ──────────────────────────────────────────────────────────────────── */

export default function BookingManagementPage() {
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
              Модуль — Управление бронированиями
            </p>
            <h1 className="text-4xl sm:text-5xl font-bold text-white tracking-tight leading-tight max-w-3xl">
              Управление бронированиями без потери статусов, дедлайнов и ручной суеты
            </h1>
            <p className="mt-6 text-lg sm:text-xl text-slate-400 leading-relaxed max-w-2xl">
              ASI помогает выстроить управляемый процесс вокруг бронирования: от подтверждения и
              подготовки объекта до заезда, проживания, продления и выезда. Система связывает
              события, правила объекта и действия команды в единый сценарий, чтобы операционная
              часть не рассыпалась по чатам, заметкам и случайным напоминаниям.
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
              Что делает ASI в управлении бронированиями
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
              Бронирование как управляемый процесс, а не просто запись в календаре
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
              Автоматизация процесса, а не слепой автопилот
            </h2>
            <p className="mt-6 text-base text-slate-600 leading-relaxed">
              ASI не должен безусловно продвигать каждый кейс по цепочке. Модуль работает по
              заданным правилам: что можно запускать автоматически, где нужно дождаться события,
              где требуется подтверждение менеджера, а где сценарий должен остановиться и передать
              кейс человеку. Это помогает сохранить контроль без ручной перегрузки.
            </p>
          </div>
        </section>

        {/* ── Connections ── */}
        <section className="py-20 sm:py-24 px-4 sm:px-6 lg:px-8 bg-white">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900">
              Что связывает модуль
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
              Покажем, как собрать бронирование в единый рабочий процесс
            </h2>
            <p className="mt-4 text-slate-400 leading-relaxed">
              Разберём, какие этапы можно автоматизировать уже сейчас, где нужны контрольные
              точки, и как убрать ручную суету вокруг заездов, продлений и выездов.
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
