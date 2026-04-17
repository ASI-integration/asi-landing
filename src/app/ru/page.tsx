import Link from 'next/link';
import { productSupportEmail } from '@/config/contact';
import { FaqAccordion } from '@/components/FaqAccordion';
import { HeroSection } from '@/components/HeroSection';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { TgIcon } from '@/components/TgIcon';
import { RuBottomQuickLinks } from '@/components/ru/RuBottomQuickLinks';
import { RuComplianceFooter } from '@/components/ru/RuComplianceFooter';
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';

const DEMO_LINK = '/connect';

/* ─── Contacts ──────────────────────────────────────────────────────────────── */
function ContactLinks({ orientation = 'row' }: { orientation?: 'row' | 'col' }) {
  const cls = orientation === 'row'
    ? 'flex flex-col sm:flex-row justify-center gap-4'
    : 'flex flex-col gap-3';

  return (
    <div className={cls}>
      <a
        href="https://t.me/ASI_core_bot"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Telegram"
        title="Telegram"
        className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-[#2CA5E0]/10 border border-[#2CA5E0]/30 text-white hover:bg-[#2CA5E0]/20 hover:border-[#2CA5E0]/60 transition-all"
      >
        <TgIcon />
        <span className="sr-only">Telegram</span>
      </a>
      <a
        href={`mailto:${productSupportEmail}`}
        className="inline-flex items-center justify-center gap-3 px-6 py-3.5 rounded-xl bg-[var(--t-surface)] border border-[var(--t-border)] text-[var(--t-text)] font-semibold text-sm hover:bg-[var(--t-surface-2)] transition-all"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-[var(--t-muted)] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25H4.5a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5H4.5a2.25 2.25 0 00-2.25 2.25m19.5 0L12 13.5 2.25 6.75" />
        </svg>
        {productSupportEmail}
      </a>
    </div>
  );
}

/* ─── Page ──────────────────────────────────────────────────────────────────── */
export default function HomeRu() {
  return (
    <ThemeProvider defaultTheme="light" className="theme-transition min-h-screen bg-[var(--t-bg)] text-[var(--t-text)]">

      <RuPublicNavHeader surface="theme" density="landing" />

      <main>

        {/* ── Hero ── */}
        <HeroSection content={{
          aboutLabel: 'О системе',
          aboutHeadline: 'Операционная система для арендного бизнеса',
          aboutBody: 'ASI автоматизирует ключевые процессы арендного бизнеса: коммуникацию с гостями, бронирования, оплаты, доступы и операционные задачи. Вы управляете результатом, а не рутиной.',
          aboutPoints: [
            'Коммуникация с гостями 24/7',
            'Бронирования и оплаты без ручной обработки',
            'Подключение человека только при необходимости',
          ],
          detailsLabel: 'Контакты',
          loginLabel: 'Войти',
          loginHref: '/login',
          offerHeadline: <>Ваш арендный бизнес.<br /><span className="text-[var(--t-accent)]">На полном автопилоте.</span></>,
          offerSub: <>Пассивный доход от вашей недвижимости<br className="hidden sm:block" /> без операционки и найма персонала</>,
          ctaLabel: 'Запросить разбор ваших объектов',
          ctaHref: DEMO_LINK,
          ctaExternal: false,
        }} telegramVariant="icon" />

        {/* ── Bridge: почему локация важна ── */}
        <section className="py-12 sm:py-14 px-4 sm:px-6 bg-[var(--t-surface-2)] border-t border-[var(--t-border)]">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-[var(--t-text)] mb-4">
              Доходность — это не только ремонт
            </h2>
            <p className="text-[var(--t-text-2)] text-base leading-relaxed mb-7">
              Один объект работает хорошо, другой — почти не загружается. Часто дело не в качестве: локация определяет, кто вообще ищет аренду в этом районе, насколько высока конкуренция и какую цену готов платить реальный гость. Без этого понимания легко ошибиться с позиционированием и ценой — ещё до запуска.
            </p>
            <ul className="space-y-2">
              {[
                'Кому реально подходит объект — и кто будет его снимат��',
                'Како�� спрос держится в районе — не по ощущениям, а по данным',
                'Какую доходность можно ожидать до старта',
              ].map((point) => (
                <li key={point} className="flex items-start gap-3 text-sm text-[var(--t-text-2)]">
                  <span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-[color:var(--t-accent)] shrink-0" />
                  {point}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── 3 продуктовых модуля ── */}
        <section className="py-16 sm:py-20 px-4 sm:px-6 bg-[var(--t-bg)] border-t border-[var(--t-border)]">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-[var(--t-text)] mb-2">
              Три направления
            </h2>
            <p className="text-[var(--t-muted)] mb-10">
              Каждое направление закрывает отдельный контур и работает как часть единой системы.
            </p>
            <div className="grid sm:grid-cols-3 gap-6">

              {/* Module 1 — Location */}
              <div className="flex flex-col p-7 rounded-2xl border border-[var(--t-border)] bg-[var(--t-surface)] hover:border-[color:var(--t-accent)]/60 hover:bg-[color-mix(in_srgb,var(--t-accent)_5%,var(--t-surface))] transition-all">
                <div className="text-3xl mb-4">📍</div>
                <h3 className="font-bold text-[var(--t-text)] text-lg mb-2">Оценка доходности</h3>
                <p className="text-sm text-[var(--t-muted)] leading-relaxed mb-6 flex-1">
                  Введите адрес — получите анализ спроса, конкуренции, магнитов трафика и ожидаемого дохода ₽/мес.
                </p>
                <Link
                  href="/ru/location-analysis"
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-[color:var(--t-accent)] hover:opacity-80 transition-opacity"
                >
                  Получить отчёт →
                </Link>
              </div>

              {/* Module 2 — Communication */}
              <div className="flex flex-col p-7 rounded-2xl border border-[var(--t-border)] bg-[var(--t-surface)] hover:border-sky-500/40 hover:bg-sky-950/10 transition-all">
                <div className="text-3xl mb-4">💬</div>
                <h3 className="font-bold text-[var(--t-text)] text-lg mb-2">Автоматизация общения</h3>
                <p className="text-sm text-[var(--t-muted)] leading-relaxed mb-6 flex-1">
                  ИИ ведёт переписку с гостями 24/7: мгновенные ответы, исполнение в чате, эскалация только в исключительных случаях.
                </p>
                <div className="flex flex-col gap-2">
                  <Link
                    href="/connect"
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-sky-400 hover:text-sky-300 transition-colors"
                  >
                    Посмотреть сценарий работы →
                  </Link>
                  <Link
                    href="/features/communication"
                    className="text-xs text-[var(--t-muted)] hover:text-[var(--t-text-2)] transition-colors"
                  >
                    Как это работает
                  </Link>
                </div>
              </div>

              {/* Module 3 — Full Platform */}
              <div className="flex flex-col p-7 rounded-2xl border border-[color:var(--t-accent)] bg-[color-mix(in_srgb,var(--t-accent)_8%,transparent)] hover:bg-[color-mix(in_srgb,var(--t-accent)_12%,transparent)] transition-all">
                <div className="text-3xl mb-4">🔄</div>
                <h3 className="font-bold text-[var(--t-text)] text-lg mb-2">Полная платформа</h3>
                <p className="text-sm text-[var(--t-text-2)] leading-relaxed mb-6 flex-1">
                  Операционный автопилот: коммуникации, бронирования, платежи и задачи — без персонала и ручного контроля.
                </p>
                <a
                  href="#pricing"
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--t-text)] hover:opacity-80 transition-opacity"
                >
                  Тарифы и подключение ↓
                </a>
              </div>

            </div>
          </div>
        </section>

        {/* ── Тарифы ── */}
        <section id="pricing" className="scroll-mt-20 py-20 sm:py-24 px-4 sm:px-6 bg-[var(--t-surface-2)] border-t border-[var(--t-border)]">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-[var(--t-text)] mb-3">
              Тарифы
            </h2>
            <p className="text-[var(--t-text-2)] text-lg leading-relaxed mb-2">
              Фиксированная стоимость. Без расширения штата.
            </p>
            <p className="text-[var(--t-muted)] text-sm mb-10">
              Коммуникация с гостями, платежи, бронирования и контроль задач — без найма. Цена за 1 объект в месяц.
            </p>
            <div className="grid sm:grid-cols-3 gap-6">

              {/* Small */}
              <Link
                href="/connect?plan=small"
                className="p-6 rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] hover:bg-[var(--t-surface-2)] transition-all flex flex-col min-h-[420px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--t-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--t-bg)]"
                aria-label="Выбрать тариф Базовый"
              >
                <span className="inline-block self-start px-3 py-1 bg-emerald-500/10 text-emerald-700 text-xs font-medium rounded-full border border-emerald-500/20">
                  🟢 Базовый
                </span>
                <p className="mt-4 text-xl font-semibold text-[var(--t-text)]">
                  12 900 ₽ / объект / месяц
                </p>
                <p className="mt-1 text-sm text-[var(--t-muted)]">
                  1–3 объекта
                </p>
                <ul className="mt-4 space-y-2 text-[var(--t-text-2)] text-sm flex-1">
                  <li>Базовая автоматизация ��оммуникации</li>
                  <li>Обработка типовых запросов гостей</li>
                  <li>Единый канал взаимодействия</li>
                  <li>Подходит для небольшого числа объектов</li>
                </ul>
                <div className="mt-6" aria-hidden />
              </Link>

              {/* Growth */}
              <Link
                href="/connect?plan=growth"
                className="p-6 rounded-xl border border-[color:var(--t-accent)] bg-[color-mix(in_srgb,var(--t-accent)_10%,transparent)] hover:bg-[color-mix(in_srgb,var(--t-accent)_14%,transparent)] transition-all flex flex-col min-h-[420px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--t-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--t-bg)]"
                aria-label="Выбрать тариф Масштабирование"
              >
                <span className="inline-block self-start px-3 py-1 bg-amber-500/10 text-amber-400 text-xs font-medium rounded-full border border-amber-500/20">
                  🟡 Масштабирование
                </span>
                <p className="mt-4 text-xl font-semibold text-[var(--t-text)]">
                  8 900 ₽ / объект / месяц
                </p>
                <p className="mt-1 text-sm text-[var(--t-text-2)]">
                  4–10 объектов
                </p>
                <ul className="mt-4 space-y-2 text-[var(--t-text-2)] text-sm flex-1">
                  <li>Включает возможности базового тарифа</li>
                  <li>Для растущего портфеля объектов</li>
                  <li>Масштабирование коммуникации и бронирований</li>
                  <li>Больше сценариев автоматизации</li>
                  <li>Подходит для активных операторов</li>
                </ul>
                <div className="mt-6" aria-hidden />
              </Link>

              {/* Enterprise */}
              <Link
                href="/connect?plan=enterprise"
                className="p-6 rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] hover:bg-[var(--t-surface-2)] transition-all flex flex-col min-h-[420px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--t-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--t-bg)]"
                aria-label="Выбрать тариф Крупный портфель"
              >
                <span className="inline-block self-start px-3 py-1 bg-blue-500/10 text-blue-400 text-xs font-medium rounded-full border border-blue-500/20">
                  🔵 Крупный портфель
                </span>
                <p className="mt-4 text-xl font-semibold text-[var(--t-text)]">
                  6 900 ₽ / объект / месяц
                </p>
                <p className="mt-1 text-sm text-[var(--t-muted)]">
                  от 20 объектов
                </p>
                <ul className="mt-4 space-y-2 text-[var(--t-text-2)] text-sm flex-1">
                  <li>Включает возможности тарифа для масштабирования</li>
                  <li>Для крупных портфелей объектов</li>
                  <li>Цен��рализованное управление ком��уникацией и брониро��аниями</li>
                  <li>Масштабирование операционного контура</li>
                  <li>Подходит для операторов и управляющих компаний</li>
                </ul>
                <div className="mt-6" aria-hidden />
              </Link>

            </div>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section id="faq" className="scroll-mt-20 py-20 sm:py-24 px-4 sm:px-6 bg-[var(--t-bg)] border-t border-[var(--t-border)]">
          <div className="max-w-3xl mx-auto">
            <h2 className="text-3xl sm:text-4xl font-bold text-[var(--t-text)] text-center tracking-tight">
              Как работает автоматизация
            </h2>
            <p className="mt-3 text-center text-sm text-[var(--t-muted)] max-w-xl mx-auto">
              Прямые ответы — без маркетинга, без жаргона.
            </p>
            <div className="mt-10">
              <FaqAccordion lang="ru" />
            </div>
          </div>
        </section>

        {/* ── CTA + contacts ── */}
        <section className="py-20 sm:py-24 px-4 sm:px-6 border-t border-[var(--t-border)] bg-[var(--t-bg)]">
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-3xl sm:text-4xl font-bold text-[var(--t-text)]">
              Покажем, как ASI будет вести ваши объекты
            </h2>
            <p className="mt-4 text-[var(--t-text-2)] text-lg">
              Система принимает входящие, отвечает гостям и ведёт операционные сценарии автоматически. Человек подключается только в исключительных случаях. На разборе покажем это на ваших объектах.
            </p>
            <Link
              href="/connect"
              className="mt-8 inline-flex items-center justify-center px-10 py-5 bg-[var(--t-accent)] text-white font-bold rounded-xl hover:bg-[var(--t-accent-hover)] transition-all shadow-lg hover:scale-[1.02] text-lg"
            >
              Запросить разбор объектов
            </Link>
            <p className="mt-4 text-sm text-[var(--t-muted)]">Без обязательств. Прямые ответы.</p>

            <div className="mt-10 pt-8 border-t border-[var(--t-border)]">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--t-muted)] mb-5">
                Или напишите напрямую
              </p>
              <ContactLinks />
              <p className="mt-4 text-xs text-[var(--t-muted)]">
                Система работает 24/7. Поддержка по новым подключениям: Пн–Пт, 9:00–18:00 МСК — обычно быстрее.
              </p>
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
