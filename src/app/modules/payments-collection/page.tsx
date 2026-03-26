import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Сбор платежей | ASI',
  description:
    'Собирайте доплаты и платежи, связанные с проживанием, в нужный момент сценария. ASI связывает платёж с гостем, бронированием и услугой — без ручной гонки за оплатой.',
};

/* ─── Data ──────────────────────────────────────────────────────────────────── */

const PROBLEMS = [
  {
    title: 'Доплаты теряются в переписках',
    desc: 'Гость согласился, менеджер отвлёкся, сообщение ушло вверх, оплата так и не была собрана вовремя.',
  },
  {
    title: 'Платёж живёт отдельно от проживания',
    desc: 'Когда ссылка на оплату, услуга и бронирование не связаны между собой, команде сложнее понять, кто, за что и на каком этапе должен заплатить.',
  },
  {
    title: 'Ручной контроль отнимает время',
    desc: 'Нужно проверять, отправлена ли ссылка, оплатил ли гость, напомнили ли ему, и что делать дальше, если оплаты нет.',
  },
  {
    title: 'Страшно автоматизировать деньги',
    desc: 'Нужны понятные правила: что можно выставлять автоматически, что требует подтверждения, а что вообще нельзя делать без человека.',
  },
];

const CAPABILITIES = [
  'формирует оплату в нужный момент сценария',
  'отправляет ссылку или QR на оплату',
  'связывает платёж с гостем, бронированием и конкретной услугой',
  'отслеживает статус оплаты',
  'напоминает об оплате по правилам',
  'переводит кейс менеджеру, если платёж просрочен или возник спорный случай',
  'сохраняет историю действий по начислению и оплате',
  'помогает не терять операционный контекст вокруг денег',
];

const HOW_IT_WORKS = [
  {
    step: '1',
    title: 'Основание',
    desc: 'Возникает событие: ранний заезд, поздний выезд, продление, доп. услуга, согласованное начисление.',
  },
  {
    step: '2',
    title: 'Правило',
    desc: 'ASI понимает, можно ли выставить оплату автоматически, нужно ли подтверждение, и по какому сценарию действовать.',
  },
  {
    step: '3',
    title: 'Платёж',
    desc: 'Гостю уходит ссылка или QR, а система фиксирует, за что именно выставлена оплата.',
  },
  {
    step: '4',
    title: 'Результат',
    desc: 'Если платёж прошёл, сценарий продолжается. Если нет, ASI напоминает, ждёт, ограничивает следующий шаг или передаёт кейс человеку.',
  },
];

const SCENARIOS = [
  {
    label: 'Ранний заезд',
    desc: 'Гость хочет заехать раньше. Система сообщает условия, формирует доплату и после оплаты переводит сценарий дальше.',
  },
  {
    label: 'Поздний выезд',
    desc: 'Поздний check-out подтверждается только после выполнения заданных условий и, при необходимости, оплаты.',
  },
  {
    label: 'Продление проживания',
    desc: 'Гость хочет остаться ещё на сутки. ASI может провести его через согласование, начисление и оплату без ручной сборки процесса с нуля.',
  },
  {
    label: 'Дополнительные услуги',
    desc: 'Трансфер, уборка, расходники, отдельные сервисы и другие платные опции могут быть встроены в понятную платежную логику.',
  },
];

const INTEGRATIONS = [
  'ЮKassa',
  'платёжные ссылки',
  'QR-оплата',
  'статусы оплат внутри сценария',
  'журнал действий по начислению и оплате',
];

/* ─── Page ──────────────────────────────────────────────────────────────────── */

export default function PaymentsCollectionPage() {
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
              Модуль — Сбор платежей
            </p>
            <h1 className="text-4xl sm:text-5xl font-bold text-white tracking-tight leading-tight max-w-3xl">
              Сбор платежей без ручных напоминаний и потери контекста
            </h1>
            <p className="mt-6 text-lg sm:text-xl text-slate-400 leading-relaxed max-w-2xl">
              ASI помогает собирать доплаты и платежи, связанные с проживанием, в нужный момент
              сценария: когда нужен ранний заезд, поздний выезд, продление, дополнительная услуга
              или другое согласованное начисление. Платёж не живёт отдельно от диалога и
              бронирования, а становится частью операционного процесса.
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
              Что делает ASI в сборе платежей
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
              Не отдельная касса, а часть сценария проживания
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
              Автоматизация там, где правила ясны
            </h2>
            <p className="mt-6 text-base text-slate-600 leading-relaxed">
              ASI не должен самостоятельно создавать любые начисления без ограничений. Модуль
              работает по заданным правилам: какие платежи допустимы, какие суммы и сценарии
              разрешены, где нужно подтверждение менеджера, а где можно продолжать автоматически.
              Это снижает хаос и не превращает оплату в неконтролируемую импровизацию.
            </p>
          </div>
        </section>

        {/* ── Integrations ── */}
        <section className="py-20 sm:py-24 px-4 sm:px-6 lg:px-8 bg-white">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900">
              Интеграции и статус
            </h2>
            <ul className="mt-8 flex flex-wrap gap-3">
              {INTEGRATIONS.map((item) => (
                <li
                  key={item}
                  className="px-4 py-2 rounded-full border border-slate-200 bg-slate-50 text-sm text-slate-700 font-medium"
                >
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-6 text-sm text-slate-500">
              Доступные способы оплаты и глубина интеграции зависят от текущей конфигурации проекта
              и этапа внедрения.
            </p>
          </div>
        </section>

        {/* ── CTA ── */}
        <section className="py-24 sm:py-32 px-4 sm:px-6 lg:px-8 bg-slate-900 text-center">
          <div className="max-w-xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-white">
              Покажем, как встроить оплату в реальный сценарий проживания
            </h2>
            <p className="mt-4 text-slate-400 leading-relaxed">
              Разберём, какие платежи можно собирать автоматически, где нужны подтверждения, и как
              связать деньги, коммуникацию и правила объекта в один рабочий процесс.
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
