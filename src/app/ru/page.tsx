import Link from 'next/link';
import { productSupportEmail } from '@/config/contact';
import { telegramSupportBotUrl } from '@/config/telegramBots';
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
          aboutHeadline: 'Система роста прибыльности недвижимости',
          aboutBody: 'ASI объединяет ИИ и операционную автоматизацию, чтобы каждый объект приносил больше при меньшей ручной нагрузке. Система помогает снижать операционные затраты, видеть слабые места и масштабировать портфель без пропорционального роста штата.',
          aboutPoints: [
            'Больше прибыли с текущих объектов',
            'Меньше ручных операций и затрат',
            'Рост портфеля без пропорционального роста штата',
          ],
          detailsLabel: 'Контакты',
          loginLabel: 'Войти',
          loginHref: '/login',
          offerHeadline: 'Больше чистой прибыли. Меньше операционной нагрузки.',
          offerSub: 'ASI помогает собственникам и управляющим компаниям улучшать экономику каждого объекта — от коммуникаций и повторяющихся задач до масштабирования операционного контура.',
        }} telegramVariant="icon" showTopRow={false} />

        {/* ── Три рычага роста ── */}
        <section className="py-14 sm:py-18 px-4 sm:px-6 bg-[var(--t-surface-2)] border-t border-[var(--t-border)]">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold text-[var(--t-text)] mb-2">
              Рост — это не только новые объекты
            </h2>
            <p className="text-[var(--t-text-2)] text-base sm:text-lg mb-8 max-w-3xl">
              Прибыль управляющей компании растёт не только от количества квартир. Важнее, сколько зарабатывает каждый объект, сколько операционных ресурсов он требует и как быстро растут расходы вместе с портфелем.
            </p>
            <div className="grid sm:grid-cols-3 gap-5">
              {[
                {
                  label: '01',
                  title: 'Больше с текущих объектов',
                  body: 'Снижайте потери из-за ручной работы и используйте единый операционный контур, чтобы существующий портфель работал эффективнее.',
                },
                {
                  label: '02',
                  title: 'Меньше операционных затрат',
                  body: 'Автоматизируйте повторяющиеся процессы, сокращайте количество ручных действий и уменьшайте стоимость обслуживания каждого объекта.',
                },
                {
                  label: '03',
                  title: 'Масштаб без раздувания штата',
                  body: 'Добавляйте объекты без необходимости пропорционально увеличивать число менеджеров, координацию и объём ручного контроля.',
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

        {/* ── Воронка: проверка → решение ── */}
        <section
          className="scroll-mt-20 py-12 sm:py-16 px-4 sm:px-6 bg-[var(--t-bg)]"
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
              Масштаб без пропорционального роста операционки
            </h2>
            <p className="text-[var(--t-text-2)] text-base sm:text-lg mb-8 max-w-2xl">
              Рост числа объектов не должен автоматически означать рост штата, ручной координации и расходов. ASI строит единый операционный контур для портфеля любого размера.
            </p>
            <div className="grid sm:grid-cols-3 gap-5">
              {[
                {
                  label: '1 объект',
                  title: 'Снимает рутину с собственника',
                  body: 'Автоматизирует обработку обращений, коммуникацию, платежи и базовые операционные сценарии без найма дополнительного персонала.',
                },
                {
                  label: '10 объектов',
                  title: 'Сдерживает рост операционных затрат',
                  body: 'Даёт единый контур управления по нескольким объектам: входящие обращения, задачи, доступы, коммуникация и видимость по доходности.',
                },
                {
                  label: '100+ объектов',
                  title: 'Масштабирует процессы, а не штат',
                  body: 'Расширяет операционный контур без пропорционального увеличения ручной координации между командами и разрозненными инструментами.',
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
                  q: 'Как ASI помогает расти без пропорционального роста штата?',
                  a: 'Повторяющиеся процессы переводятся в единый автоматизированный контур. Поэтому увеличение портфеля не требует такого же роста ручной координации и количества операционных сотрудников.',
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
                href={telegramSupportBotUrl}
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
