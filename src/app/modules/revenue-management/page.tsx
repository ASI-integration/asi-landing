import Link from 'next/link';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Управление доходностью | ASI',
  description:
    'Управляйте доходностью объекта с учётом спроса, типа объекта, правил продаж и целевого профиля гостя — без ценового хаоса и ручных догадок.',
};

/* ─── Data ──────────────────────────────────────────────────────────────────── */

const PROBLEMS = [
  {
    title: 'Цены меняются слишком хаотично',
    desc: 'Без понятной логики цена часто ставится "на глаз", по настроению или по запоздалой реакции на рынок.',
  },
  {
    title: 'Ориентация только на конкурентов искажает картину',
    desc: 'Повторять чужие цены недостаточно. У объектов разная экономика, аудитория, сезонность и ограничения.',
  },
  {
    title: 'Красивые метрики не всегда дают лучший результат',
    desc: 'Высокая загрузка или средняя цена сами по себе не гарантируют лучшую итоговую доходность.',
  },
  {
    title: 'Сложно связать цену с реальной стратегией объекта',
    desc: 'Нужна логика, которая учитывает не только спрос, но и то, кого объект хочет привлекать, через какие каналы и на каких условиях.',
  },
];

const CAPABILITIES = [
  'помогает формировать логику цен по правилам и сигналам',
  'учитывает спрос, загрузку, окно до заезда и поведение бронирований',
  'позволяет учитывать тип объекта и целевой профиль гостя',
  'помогает не сводить стратегию только к копированию конкурентов',
  'связывает цену с каналами, условиями и ограничениями продажи',
  'помогает управлять не только ставкой, но и качеством спроса',
  'даёт более управляемую основу для решений по доходности',
  'сохраняет прозрачность логики, а не превращает цену в чёрный ящик',
];

const HOW_IT_WORKS = [
  {
    step: '1',
    title: 'Сигналы',
    desc: 'Система учитывает загрузку, окно до заезда, тип спроса, сезонные и объектные факторы, правила продажи и другие доступные сигналы.',
  },
  {
    step: '2',
    title: 'Контекст',
    desc: 'ASI понимает, какой это объект, какую аудиторию он хочет привлекать, какие ограничения действуют и какая стратегия нужна в текущий момент.',
  },
  {
    step: '3',
    title: 'Решение',
    desc: 'Система помогает определить более уместную ценовую логику: удерживать ставку, усиливать спрос, защищать доходность или менять условия.',
  },
  {
    step: '4',
    title: 'Результат',
    desc: 'Цена становится частью стратегии, а не случайной цифрой. Команда получает более понятную и управляемую модель принятия решений.',
  },
];

const SCENARIOS = [
  {
    label: 'Городской объект с бизнес-спросом',
    desc: 'Важно не просто заполнять календарь, а удерживать более качественный и устойчивый спрос без лишней ценовой паники.',
  },
  {
    label: 'Периоды слабого спроса',
    desc: 'ASI помогает не обрушивать цену бездумно, а искать более точную реакцию с учётом правил и целей объекта.',
  },
  {
    label: 'Пиковые даты и повышенный спрос',
    desc: 'Когда рынок разогрет, модуль помогает не терять доходность из-за запоздалой или слишком осторожной реакции.',
  },
  {
    label: 'Разные типы объектов',
    desc: 'Стратегия может отличаться для городских, туристических и смешанных объектов. Модуль помогает не применять одну и ту же логику ко всем подряд.',
  },
];

const CONNECTIONS = [
  'спрос и загрузка',
  'правила продаж и ограничения',
  'тип объекта и профиль гостя',
  'каналы и условия бронирования',
  'сценарии проживания и окна заезда',
  'логика чистой доходности',
];

/* ─── Page ──────────────────────────────────────────────────────────────────── */

export default function RevenueManagementPage() {
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
              Модуль — Управление доходностью
            </p>
            <h1 className="text-4xl sm:text-5xl font-bold text-white tracking-tight leading-tight max-w-3xl">
              Управление доходностью без ценового хаоса и ручных догадок
            </h1>
            <p className="mt-6 text-lg sm:text-xl text-slate-400 leading-relaxed max-w-2xl">
              ASI помогает выстраивать логику доходности вокруг объекта: учитывать спрос, загрузку,
              тип объекта, ограничения, правила продаж и целевую аудиторию. Вместо ручной суеты и
              попыток "попасть в рынок" система помогает принимать более управляемые решения по
              цене и стратегии продажи ночей.
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
              Что делает ASI в управлении доходностью
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
              Не магия цен, а управляемая логика доходности
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
              Автоматизация не вместо стратегии, а внутри стратегии
            </h2>
            <p className="mt-6 text-base text-slate-600 leading-relaxed">
              ASI не должен бесконтрольно менять цены без рамок. Модуль работает по заданной
              логике: какие правила допустимы, где нужны ограничения, какие сигналы имеют вес, а
              где решение должно остаться за человеком. Это позволяет автоматизировать рутину, не
              теряя стратегического контроля.
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
              Покажем, как выстроить логику доходности под ваш объект
            </h2>
            <p className="mt-4 text-slate-400 leading-relaxed">
              Разберём, какие сигналы и правила важны именно для вашего формата, где можно
              автоматизировать ценовые решения уже сейчас, и как уйти от ручной суеты к более
              осмысленной стратегии.
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
