import Link from 'next/link';
import { productSupportEmail } from '@/config/contact';
import { HeroSection } from '@/components/HeroSection';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { TgIcon } from '@/components/TgIcon';
import { RuBottomQuickLinks } from '@/components/ru/RuBottomQuickLinks';
import { RuComplianceFooter } from '@/components/ru/RuComplianceFooter';
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';

const CONNECT_HREF = '/connect';
/** Публичный ввод адреса и расчёт (демо / экспресс-проверка). */
const RU_LOCATION_CHECK_HREF = '/ru/location-analysis?mode=residential#location-check';

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
          offerHeadline: 'ASI: ваш объект недвижимости на 99% на автопилоте',
          offerSub: 'Пассивный доход практически без вашего участия.',
        }} telegramVariant="icon" showTopRow={false} />

        {/* ── Воронка: проверка → решение ── */}
        <section
          className="scroll-mt-20 py-12 sm:py-16 px-4 sm:px-6 bg-[var(--t-bg)] border-t-2 border-[color:var(--t-accent)]"
        >
          <div className="max-w-5xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-[var(--t-text)] mb-2">
              Как ASI помогает принять решение по объекту
            </h2>
            <p className="text-[var(--t-text-2)] text-base sm:text-lg mb-8 max-w-2xl">
              Сначала проверьте адрес, затем используйте вывод для решения до вложений.
            </p>
            <div className="grid md:grid-cols-2 gap-6">

              <div className="flex flex-col p-7 sm:p-8 rounded-2xl border-2 border-[color:var(--t-accent)] bg-[color-mix(in_srgb,var(--t-accent)_8%,var(--t-surface))] min-h-[300px]">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[color:var(--t-accent)] text-white text-2xl font-bold mb-5" aria-hidden>
                  1
                </span>
                <h3 className="font-bold text-[var(--t-text)] text-lg leading-snug mb-3">
                  Проверьте объект
                </h3>
                <p className="text-[15px] text-[var(--t-text-2)] leading-relaxed flex-1 mb-6">
                  Введите адрес и получите общий вывод по локации: спрос, риски и ближайшие сильные объекты.
                </p>
                <Link
                  href={RU_LOCATION_CHECK_HREF}
                  className="inline-flex items-center justify-center px-6 py-3.5 rounded-xl bg-[var(--t-accent)] text-white font-bold text-sm sm:text-base hover:bg-[var(--t-accent-hover)] transition-colors shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--t-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--t-surface)]"
                >
                  Оценить объект по адресу
                </Link>
              </div>

              <div className="flex flex-col p-7 sm:p-8 rounded-2xl border-2 border-[color:var(--t-accent)] bg-[color-mix(in_srgb,var(--t-accent)_8%,var(--t-surface))] min-h-[300px]">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[color:var(--t-accent)] text-white text-2xl font-bold mb-5" aria-hidden>
                  2
                </span>
                <h3 className="font-bold text-[var(--t-text)] text-lg leading-snug mb-3">
                  Примите решение на данных
                </h3>
                <p className="text-[15px] text-[var(--t-text-2)] leading-relaxed flex-1">
                  Используйте общий вывод, чтобы понять, стоит ли рассматривать объект дальше. Подробный отчёт доступен в личном кабинете.
                </p>
              </div>

            </div>
          </div>
        </section>

        {/* ── После проверки локации ── */}
        <section className="py-12 sm:py-14 px-4 sm:px-6 bg-[var(--t-surface-2)] border-t border-[var(--t-border)]">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="text-xl sm:text-2xl font-bold text-[var(--t-text)] mb-3">
              Отчёт нужен до любого решения по объекту
            </h2>
            <p className="text-[var(--t-text-2)] text-sm sm:text-base leading-relaxed mb-6">
              Проверьте локацию, спрос, риски и сценарии монетизации до покупки, запуска посуточной аренды или подключения управления ASI.
            </p>
            <Link
              href={CONNECT_HREF}
              className="inline-flex items-center justify-center px-8 py-4 rounded-xl bg-[var(--t-accent)] text-white font-bold text-base hover:bg-[var(--t-accent-hover)] transition-colors shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--t-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--t-surface-2)]"
            >
              Запросить подключение
            </Link>
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
                  a: 'Проверка локации по адресу и операционный контур: входящие обращения, переписка с гостями и повторяющиеся задачи по объектам.',
                },
                {
                  q: 'Как работает коммуникация с гостями?',
                  a: 'Принимает обращения, ведёт переписку и закрывает типовые сценарии. Человек подключается, когда нужно суждение в нестандартной ситуации.',
                },
                {
                  q: 'Что показывает проверка локации?',
                  a: 'Спрос в зоне, магниты трафика рядом, конкуренцию и расчётный потенциал доходности — до запуска или при смене стратегии объекта.',
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
                  a: 'Оставьте заявку через форму. Мы смотрим на ваши объекты и текущие задачи, после чего предлагаем конкретный следующий шаг.',
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
