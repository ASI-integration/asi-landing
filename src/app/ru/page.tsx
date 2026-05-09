import Link from 'next/link';
import { productSupportEmail } from '@/config/contact';
import { HeroSection } from '@/components/HeroSection';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { TgIcon } from '@/components/TgIcon';
import { RuBottomQuickLinks } from '@/components/ru/RuBottomQuickLinks';
import { RuComplianceFooter } from '@/components/ru/RuComplianceFooter';
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';

const DEMO_LINK = '/connect';

/* ─── Page ──────────────────────────────────────────────────────────────────── */
export default function HomeRu() {
  return (
    <ThemeProvider defaultTheme="light" className="theme-transition min-h-screen bg-[var(--t-bg)] text-[var(--t-text)]">

      <RuPublicNavHeader surface="theme" density="landing" />

      <main>

        {/* ── Hero ── */}
        <HeroSection content={{
          aboutLabel: 'О системе',
          aboutHeadline: 'Система операционной автоматизации',
          aboutBody: 'ASI — это не дашборд и не ПО, которым вы управляете вручную. Это операционная инфраструктура: ИИ-слой, который ведёт ваш портфель объектов от начала до конца — без персонала и ручного контроля.',
          aboutPoints: [
            'Не дашборд',
            'Не ПО для ручного управления',
            'Заменяет операционный слой целиком',
          ],
          detailsLabel: 'Контакты',
          loginLabel: 'Войти',
          loginHref: '/login',
          offerHeadline: 'Автопилот для вашего арендного бизнеса',
          offerSub: 'ASI автоматизирует коммуникацию и операционные сценарии. До 99% автоматизации процессов и снижение затрат на персонал.',
          ctaLabel: 'Запросить разбор объектов',
          ctaHref: DEMO_LINK,
          ctaExternal: false,
        }} telegramVariant="icon" showTopRow={false} />

        {/* ── Что такое ASI (коротко) ── */}
        <section className="py-14 sm:py-16 px-4 sm:px-6 bg-[var(--t-bg)] border-t border-[var(--t-border)]">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-[var(--t-text)] mb-2">
              Что такое ASI
            </h2>
            <p className="text-[var(--t-text-2)] text-base sm:text-lg leading-relaxed max-w-3xl">
              ASI — это операционный слой, который исполняет процессы вместо команды: принимает обращения, ведёт гостей, запускает сценарии, контролирует выполнение и собирает операционную аналитику.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/ru/how-it-works"
                className="inline-flex items-center justify-center px-6 py-3 rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] hover:bg-[var(--t-surface-2)] transition-colors text-sm font-semibold"
              >
                Подробнее о платформе и сценариях →
              </Link>
              <Link
                href={DEMO_LINK}
                className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-[var(--t-accent)] text-white font-semibold text-sm hover:bg-[var(--t-accent-hover)] transition-colors"
              >
                Запросить разбор объектов →
              </Link>
            </div>
          </div>
        </section>

        {/* ── Ключевые модули ── */}
        <section className="py-16 sm:py-20 px-4 sm:px-6 bg-[var(--t-surface-2)] border-t-2 border-[color:var(--t-accent)]">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-[var(--t-text)] mb-2">
              Ключевые модули ASI
            </h2>
            <p className="text-[var(--t-text-2)] text-base sm:text-lg mb-8 max-w-2xl">
              ASI объединяет ключевые операционные модули в одной системе: коммуникацию, оценку локации и доходности, а также операционные сценарии управления объектами.
            </p>
            <div className="grid sm:grid-cols-3 gap-5">

              {/* Card 1 — Коммуникационный модуль */}
              <Link
                href="/connect"
                aria-label="Открыть подключение: коммуникационный модуль"
                className="group flex flex-col p-7 sm:p-8 rounded-2xl border-2 border-[color:var(--t-accent)] bg-[color-mix(in_srgb,var(--t-accent)_8%,var(--t-surface))] hover:bg-[color-mix(in_srgb,var(--t-accent)_12%,var(--t-surface))] transition-colors min-h-[260px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--t-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--t-surface-2)]"
              >
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h3 className="font-bold text-[var(--t-text)] text-lg leading-snug">
                    Коммуникационный модуль
                  </h3>
                </div>
                <p className="text-[15px] text-[var(--t-text-2)] leading-relaxed flex-1">
                  Обрабатывает сообщения гостей, помогает вести переписку, поддерживает голосовой сервис и готовится к работе со звонками.
                </p>
                <span className="mt-5 inline-flex items-center justify-center px-5 py-3 rounded-xl bg-[color:var(--t-accent)] text-white font-semibold text-sm group-hover:bg-[color:var(--t-accent-hover)] transition-colors">
                  Запросить подключение →
                </span>
              </Link>

              {/* Card 2 — Модуль оценки локации и доходности */}
              <Link
                href="/ru/location-analysis"
                aria-label="Открыть анализ локации"
                className="group flex flex-col p-7 sm:p-8 rounded-2xl border-2 border-[color:var(--t-accent)] bg-[color-mix(in_srgb,var(--t-accent)_8%,var(--t-surface))] hover:bg-[color-mix(in_srgb,var(--t-accent)_12%,var(--t-surface))] transition-colors min-h-[260px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--t-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--t-surface-2)]"
              >
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h3 className="font-bold text-[var(--t-text)] text-lg leading-snug">
                    Модуль оценки локации и доходности
                  </h3>
                </div>
                <p className="text-[15px] text-[var(--t-text-2)] leading-relaxed flex-1">
                  Показывает спрос, конкуренцию и уровень цен рядом с объектом, чтобы помочь оценить его потенциал доходности.
                </p>
                <span className="mt-5 inline-flex items-center justify-center px-5 py-3 rounded-xl bg-[color:var(--t-accent)] text-white font-semibold text-sm group-hover:bg-[color:var(--t-accent-hover)] transition-colors">
                  Открыть анализ локации →
                </span>
              </Link>

              {/* Card 3 — Операционный модуль */}
              <Link
                href="/connect"
                aria-label="Открыть подключение: операционный модуль"
                className="group flex flex-col p-7 sm:p-8 rounded-2xl border-2 border-[color:var(--t-accent)] bg-[color-mix(in_srgb,var(--t-accent)_8%,var(--t-surface))] hover:bg-[color-mix(in_srgb,var(--t-accent)_12%,var(--t-surface))] transition-colors min-h-[260px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--t-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--t-surface-2)]"
              >
                <div className="flex items-center justify-between gap-3 mb-3">
                  <h3 className="font-bold text-[var(--t-text)] text-lg leading-snug">
                    Операционный модуль
                  </h3>
                </div>
                <p className="text-[15px] text-[var(--t-text-2)] leading-relaxed flex-1">
                  Берёт на себя рутинные процессы по объекту: доступы, check-in, задачи, инциденты, оплаты и контроль выполнения.
                </p>
                <span className="mt-5 inline-flex items-center justify-center px-5 py-3 rounded-xl bg-[color:var(--t-accent)] text-white font-semibold text-sm group-hover:bg-[color:var(--t-accent-hover)] transition-colors">
                  Запросить подключение →
                </span>
              </Link>

            </div>
          </div>
        </section>

        {/* ── Растёт вместе с вами ── */}
        <section id="scale" className="scroll-mt-20 py-16 sm:py-20 px-4 sm:px-6 bg-[var(--t-bg)] border-t border-[var(--t-border)]">
          <div className="max-w-4xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-[var(--t-text)] mb-2">
              Растёт вместе с вами
            </h2>
            <p className="text-[var(--t-text-2)] text-base sm:text-lg mb-8 max-w-2xl">
              Один объект или сотня. ASI справляется с разным масштабом без перестройки процессов.
            </p>
            <div className="grid sm:grid-cols-3 gap-5">
              {[
                {
                  label: '1 объект',
                  title: 'Для собственника одной квартиры',
                  body: 'Автоматизирует обработку обращений, коммуникацию, платежи и базовые операционные сценарии без найма дополнительного персонала.',
                },
                {
                  label: '10 объектов',
                  title: 'Для оператора портфеля',
                  body: 'Даёт единый контур управления по нескольким объектам: входящие обращения, задачи, доступы, коммуникация и видимость по доходности.',
                },
                {
                  label: '100+ объектов',
                  title: 'Для управляющей компании',
                  body: 'Масштабирует операционный контур без ручной координации между командами и разрозненными инструментами.',
                },
              ].map(({ label, title, body }) => (
                <div key={label} className="flex flex-col p-6 rounded-2xl border border-[var(--t-border)] bg-[var(--t-surface)]">
                  <span className="text-xs font-bold uppercase tracking-widest text-[var(--t-muted)] mb-3">{label}</span>
                  <h3 className="font-bold text-[var(--t-text)] text-base leading-snug mb-3">{title}</h3>
                  <p className="text-sm text-[var(--t-text-2)] leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Тарифы ── */}
        <section id="pricing" className="scroll-mt-20 py-20 sm:py-24 px-4 sm:px-6 bg-[var(--t-surface-2)] border-t border-[var(--t-border)]">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-[var(--t-text)] mb-3">
              Тарифы
            </h2>
            <p className="text-[var(--t-text-2)] text-lg leading-relaxed mb-10">
              Выберите формат подключения под ваш масштаб и задачи.
            </p>
            <div className="grid sm:grid-cols-3 gap-6">

              {/* Owner */}
              <Link
                href="/connect?plan=small"
                className="p-6 rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] hover:bg-[var(--t-surface-2)] transition-all flex flex-col min-h-[420px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--t-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--t-bg)]"
                aria-label="Выбрать тариф Для собственника"
              >
                <span className="inline-block self-start px-3 py-1 bg-emerald-500/10 text-emerald-700 text-xs font-medium rounded-full border border-emerald-500/20">
                  1–3 объекта
                </span>
                <p className="mt-4 text-xl font-semibold text-[var(--t-text)]">
                  12 900 ₽ / объект / месяц
                </p>
                <p className="mt-1 text-sm text-[var(--t-muted)] font-medium">
                  Для собственника
                </p>
                <p className="mt-4 text-[var(--t-text-2)] text-sm leading-relaxed flex-1">
                  Подходит для собственников, которые хотят автоматизировать входящие обращения, коммуникацию с гостями и базовые операционные сценарии без найма дополнительного персонала.
                </p>
                <div className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[var(--t-text)]">
                  Выбрать <span className="text-[var(--t-muted)]" aria-hidden>→</span>
                </div>
              </Link>

              {/* Operator */}
              <Link
                href="/connect?plan=growth"
                className="p-6 rounded-xl border border-[color:var(--t-accent)] bg-[color-mix(in_srgb,var(--t-accent)_10%,transparent)] hover:bg-[color-mix(in_srgb,var(--t-accent)_14%,transparent)] transition-all flex flex-col min-h-[420px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--t-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--t-bg)]"
                aria-label="Выбрать тариф Для оператора"
              >
                <span className="inline-block self-start px-3 py-1 bg-amber-500/10 text-amber-400 text-xs font-medium rounded-full border border-amber-500/20">
                  До 15 объектов
                </span>
                <p className="mt-4 text-xl font-semibold text-[var(--t-text)]">
                  8 900 ₽ / объект / месяц
                </p>
                <p className="mt-1 text-sm text-[var(--t-text-2)] font-medium">
                  Для оператора
                </p>
                <p className="mt-4 text-[var(--t-text-2)] text-sm leading-relaxed flex-1">
                  Для операторов, которым нужен единый контур работы с несколькими объектами: коммуникация, обращения, задачи, доступы и видимость по доходности.
                </p>
                <div className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[var(--t-text)]">
                  Выбрать <span className="text-[var(--t-muted)]" aria-hidden>→</span>
                </div>
              </Link>

              {/* Management company */}
              <Link
                href="/connect?plan=enterprise"
                className="p-6 rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] hover:bg-[var(--t-surface-2)] transition-all flex flex-col min-h-[420px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--t-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--t-bg)]"
                aria-label="Выбрать тариф Для управляющей компании"
              >
                <span className="inline-block self-start px-3 py-1 bg-blue-500/10 text-blue-400 text-xs font-medium rounded-full border border-blue-500/20">
                  Индивидуально
                </span>
                <p className="mt-4 text-xl font-semibold text-[var(--t-text)]">
                  По запросу
                </p>
                <p className="mt-1 text-sm text-[var(--t-muted)] font-medium">
                  Для управляющей компании
                </p>
                <p className="mt-4 text-[var(--t-text-2)] text-sm leading-relaxed flex-1">
                  Для портфелей с большим числом объектов, кастомной логикой процессов и отдельными требованиями к внедрению и поддержке.
                </p>
                <div className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[var(--t-text)]">
                  Выбрать <span className="text-[var(--t-muted)]" aria-hidden>→</span>
                </div>
              </Link>

            </div>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section id="faq" className="scroll-mt-20 py-20 sm:py-24 px-4 sm:px-6 bg-[var(--t-bg)] border-t border-[var(--t-border)]">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-[var(--t-text)] mb-2">
              Вопросы
            </h2>
            <p className="text-[var(--t-text-2)] text-base sm:text-lg mb-8 max-w-2xl">
              Коротко отвечаем на главные вопросы о том, что уже доступно и как это работает.
            </p>
            <div className="flex flex-col divide-y divide-[var(--t-border)]">
              {[
                {
                  q: 'Что уже доступно прямо сейчас?',
                  a: 'Два модуля: коммуникационный и оценки локации. Первый принимает входящие обращения и ведёт переписку с гостями. Второй оценивает потенциал объекта по спросу, окружению и конкурентам.',
                },
                {
                  q: 'Как работает коммуникационный модуль?',
                  a: 'Принимает входящие обращения, ведёт переписку с гостями и автоматизирует типовые диалоговые сценарии. Оператор видит историю и подключается только в нестандартных ситуациях.',
                },
                {
                  q: 'Что показывает модуль оценки локации?',
                  a: 'Спрос в зоне, ближайшие магниты трафика, конкурентную плотность и расчётный потенциал доходности. Удобно перед запуском объекта или при пересмотре позиционирования.',
                },
                {
                  q: 'Кому это уже подходит?',
                  a: 'Собственникам одного–нескольких объектов, операторам небольших портфелей и управляющим компаниям. Точка входа — когда ручная операционная нагрузка становится заметной.',
                },
                {
                  q: 'Нужен ли большой штат для работы с ASI?',
                  a: 'Нет. Система берёт на себя входящие обращения, переписку и повторяющиеся операционные задачи. Оператор нужен для нестандартных ситуаций и решений, которые требуют суждения.',
                },
                {
                  q: 'Как происходит подключение?',
                  a: 'Оставьте заявку через форму. Мы смотрим на ваши объекты и текущие задачи, после чего предлагаем конкретный формат работы.',
                },
              ].map(({ q, a }) => (
                <details key={q} className="group py-3 list-none [&::-webkit-details-marker]:hidden">
                  <summary className="flex items-start justify-between gap-4 rounded-xl px-3 py-2 text-[var(--t-text)] font-semibold text-sm sm:text-base leading-snug select-none cursor-pointer hover:bg-[var(--t-surface-2)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--t-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--t-bg)]">
                    <span>{q}</span>
                    <span className="mt-0.5 shrink-0 text-[var(--t-muted)] transition-transform duration-200 group-open:rotate-45 group-hover:text-[var(--t-text)]" aria-hidden>+</span>
                  </summary>
                  <p className="mt-3 px-3 pb-3 text-sm text-[var(--t-text-2)] leading-relaxed">
                    {a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

      </main>

      {/* ── Footer ── */}
      <footer>
        <RuBottomQuickLinks tone="theme" />
        <div className="py-6 px-4 sm:px-6 border-t border-[var(--t-border)] bg-[var(--t-bg)]">
          <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className="text-[var(--t-text)] font-bold text-lg">ASI</span>
              <span className="text-xs text-[var(--t-muted)]">© {new Date().getFullYear()}</span>
            </div>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-5 text-sm">
              <a
                href="https://t.me/ASI_core_bot"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Telegram"
                title="Telegram"
                className="flex items-center justify-center w-9 h-9 rounded-lg bg-[#2CA5E0]/10 border border-[#2CA5E0]/25 text-sky-300 hover:bg-[#2CA5E0]/20 hover:border-[#2CA5E0]/50 transition-all"
              >
                <TgIcon className="w-4 h-4" />
                <span className="sr-only">Telegram</span>
              </a>
              <a
                href={`mailto:${productSupportEmail}`}
                className="text-[var(--t-muted)] hover:text-[var(--t-text)] transition-colors break-all"
              >
                {productSupportEmail}
              </a>
            </div>
          </div>
        </div>
        <RuComplianceFooter tone="theme" />
      </footer>

    </ThemeProvider>
  );
}
