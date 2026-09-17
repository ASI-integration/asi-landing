import Link from 'next/link';
import { productSupportEmail } from '@/config/contact';
import { telegramSupportBotUrl } from '@/config/telegramBots';
import { HeroSection } from '@/components/HeroSection';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { TgIcon } from '@/components/TgIcon';
import { RuBottomQuickLinks } from '@/components/ru/RuBottomQuickLinks';
import { RuComplianceFooter } from '@/components/ru/RuComplianceFooter';
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';
import {
  COMMUNICATION_PILOT_PRICE_RUB,
  COMMUNICATION_PILOT_SERVICE_TITLE,
} from '@/lib/payments/yookassa-env';

const PILOT_HREF = '/ru/early-access';
const CONNECT_HREF = '/connect';
/** Secondary product: location scoring demo. */
const RU_LOCATION_CHECK_HREF = '/ru/location-analysis?mode=residential#location-check';

export default function HomeRu() {
  return (
    <ThemeProvider defaultTheme="light" className="theme-transition min-h-screen bg-[var(--t-bg)] text-[var(--t-text)]">
      <RuPublicNavHeader surface="theme" density="landing" />

      <main>
        <HeroSection
          content={{
            aboutLabel: 'Сейчас в пилоте',
            aboutHeadline: 'AI-ответы гостям для посуточной аренды',
            aboutBody:
              'ASI помогает владельцам и операторам короткосрочной аренды закрывать типовые вопросы гостей без постоянного сидения в переписке. Нестандартные случаи остаются за человеком.',
            aboutPoints: [
              'Для собственников и операторов посуточных объектов',
              'Сейчас: рутинная коммуникация с гостями',
              'Человек подключается к исключениям',
            ],
            detailsLabel: 'Контакты',
            loginLabel: 'Войти',
            loginHref: '/login',
            offerHeadline: 'Меньше ручной переписки с гостями',
            offerSub:
              'Пилот AI-коммуникаций: один объект, один месяц. Типовые ответы — системе, сложные вопросы — вам.',
            ctaLabel: 'Подключить пилот',
            ctaHref: PILOT_HREF,
            ctaExternal: false,
            ctaSub: `${COMMUNICATION_PILOT_SERVICE_TITLE} · ${COMMUNICATION_PILOT_PRICE_RUB} ₽`,
            heroBenefits: [
              {
                title: 'Что делает сейчас',
                body: 'Отвечает на частые вопросы гостей в цифровых каналах по данным вашего объекта.',
              },
              {
                title: 'Что остаётся за вами',
                body: 'Решения по исключениям, правилам объекта и ситуациям, где нужно суждение человека.',
              },
              {
                title: 'Как подключиться',
                body: 'Оставьте заявку на пилот — поможем настроить один объект и пройти первые обращения.',
              },
              {
                title: 'Тариф пилота',
                body: `${COMMUNICATION_PILOT_PRICE_RUB} ₽ за один объект на один месяц. Оплата через ЮKassa подключается после модерации.`,
              },
            ],
          }}
          telegramVariant="icon"
          showTopRow={false}
        />

        <section className="scroll-mt-20 border-t border-[var(--t-border)] bg-[var(--t-bg)] px-4 py-12 sm:px-6 sm:py-16">
          <div className="mx-auto max-w-5xl">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--t-muted)]">Сейчас / пилот</p>
            <h2 className="mt-3 text-2xl font-bold text-[var(--t-text)] sm:text-3xl">
              Один понятный путь для закрытого пилота
            </h2>
            <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--t-text-2)]">
              Главная цель сейчас — подключить AI-ответы гостям на одном объекте, а не запускать весь операционный контур
              сразу.
            </p>
            <ol className="mt-8 grid gap-4 md:grid-cols-3">
              {[
                {
                  n: '1',
                  title: 'Пилот и тариф',
                  body: 'Смотрите состав услуги и условия на странице пилота.',
                  href: PILOT_HREF,
                  label: 'Открыть пилот',
                },
                {
                  n: '2',
                  title: 'Заявка',
                  body: 'Оставляете контакты и данные по объекту — мы связываемся для настройки.',
                  href: `${PILOT_HREF}#pilot-form`,
                  label: 'К заявке',
                },
                {
                  n: '3',
                  title: 'Кабинет',
                  body: 'После согласования входите в продукт и продолжаете подключение объекта.',
                  href: CONNECT_HREF,
                  label: 'Подключение',
                },
              ].map((step) => (
                <div
                  key={step.n}
                  className="flex flex-col rounded-2xl border border-[var(--t-border)] bg-[var(--t-surface)] p-6"
                >
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[var(--t-accent)] text-sm font-bold text-white">
                    {step.n}
                  </span>
                  <h3 className="mt-4 text-lg font-bold text-[var(--t-text)]">{step.title}</h3>
                  <p className="mt-2 flex-1 text-sm leading-6 text-[var(--t-text-2)]">{step.body}</p>
                  <Link
                    href={step.href}
                    className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--t-accent)] px-4 text-sm font-semibold text-white hover:bg-[var(--t-accent-hover)]"
                  >
                    {step.label}
                  </Link>
                </div>
              ))}
            </ol>
          </div>
        </section>

        <section className="border-t border-[var(--t-border)] bg-[var(--t-surface-2)] px-4 py-12 sm:px-6 sm:py-14">
          <div className="mx-auto max-w-3xl">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--t-muted)]">Дополнительно</p>
            <h2 className="mt-3 text-xl font-bold text-[var(--t-text)] sm:text-2xl">Оценка локации — отдельный инструмент</h2>
            <p className="mt-3 text-sm leading-7 text-[var(--t-text-2)] sm:text-base">
              Проверка адреса по спросу и окружению доступна как вспомогательный продукт. Для закрытого пилота AI-ответов
              гостям это не основной шаг.
            </p>
            <Link
              href={RU_LOCATION_CHECK_HREF}
              className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] px-5 text-sm font-semibold text-[var(--t-text)] hover:bg-[var(--t-bg)]"
            >
              Оценить локацию по адресу
            </Link>
          </div>
        </section>

        <section className="border-t border-[var(--t-border)] bg-[var(--t-bg)] px-4 py-12 sm:px-6 sm:py-16">
          <div className="mx-auto max-w-4xl">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-[var(--t-muted)]">Дорожная карта платформы</p>
            <h2 className="mt-3 text-2xl font-bold text-[var(--t-text)]">Куда развивается ASI</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-[var(--t-text-2)] sm:text-base">
              Ниже — направление продукта, а не состав текущего пилота. Эти возможности не входят в тариф «1 объект / 1
              месяц» как готовая услуга «уже сейчас».
            </p>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {[
                'Синхронизация объявлений и каналов',
                'Динамическое ценообразование',
                'Координация уборок и доступов',
                'Операционная аналитика и отчётность',
              ].map((item) => (
                <li
                  key={item}
                  className="rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] px-4 py-3 text-sm text-[var(--t-text-2)]"
                >
                  {item}
                </li>
              ))}
            </ul>
            <Link
              href="/ru/how-it-works"
              className="mt-6 inline-flex text-sm font-semibold text-[var(--t-text)] underline underline-offset-2"
            >
              Подробнее о платформе и дорожной карте
            </Link>
          </div>
        </section>

        <section id="faq" className="scroll-mt-20 border-t border-[var(--t-border)] bg-[var(--t-bg)] px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-3xl">
            <h2 className="text-2xl font-bold text-[var(--t-text)] sm:text-3xl">Вопросы</h2>
            <p className="mt-2 text-base text-[var(--t-text-2)]">Коротко о том, что доступно в пилоте сейчас.</p>
            <div className="mt-8 flex flex-col divide-y divide-[var(--t-border)]">
              {[
                {
                  q: 'Что доступно в закрытом пилоте прямо сейчас?',
                  a: 'AI-коммуникации для одного объекта на один месяц: ответы на типовые вопросы гостей. Оценка локации — отдельный инструмент.',
                },
                {
                  q: 'Когда подключается человек?',
                  a: 'Когда вопрос нестандартный или нужно ваше решение. Типовые сценарии система закрывает сама.',
                },
                {
                  q: 'Это уже полная автоматизация объекта?',
                  a: 'Нет. Полный операционный контур — направление платформы. Сейчас пилот сфокусирован на гостевой переписке.',
                },
                {
                  q: 'Как подключиться?',
                  a: 'Нажмите «Подключить пилот», оставьте заявку и пройдите настройку одного объекта с нашей помощью.',
                },
              ].map(({ q, a }) => (
                <details key={q} className="group list-none py-3 [&::-webkit-details-marker]:hidden">
                  <summary className="flex cursor-pointer items-start justify-between gap-4 rounded-xl px-3 py-2 text-sm font-semibold leading-snug text-[var(--t-text)] hover:bg-[var(--t-surface-2)] sm:text-base">
                    <span>{q}</span>
                    <span className="mt-0.5 shrink-0 text-[var(--t-muted)] transition-transform group-open:rotate-45" aria-hidden>
                      +
                    </span>
                  </summary>
                  <p className="mt-3 px-3 pb-3 text-sm leading-relaxed text-[var(--t-text-2)]">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer>
        <RuBottomQuickLinks tone="theme" />
        <div className="border-t border-[var(--t-border)] bg-[var(--t-bg)] px-4 py-6 sm:px-6">
          <div className="mx-auto flex max-w-6xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <span className="text-lg font-bold text-[var(--t-text)]">ASI</span>
              <span className="text-xs text-[var(--t-muted)]">© {new Date().getFullYear()}</span>
            </div>
            <div className="flex flex-col items-start gap-3 text-sm sm:flex-row sm:items-center sm:gap-5">
              <a
                href={telegramSupportBotUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Telegram"
                title="Telegram"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#2CA5E0]/25 bg-[#2CA5E0]/10 text-sky-300 transition-all hover:border-[#2CA5E0]/50 hover:bg-[#2CA5E0]/20"
              >
                <TgIcon className="h-4 w-4" />
                <span className="sr-only">Telegram</span>
              </a>
              <a
                href={`mailto:${productSupportEmail}`}
                className="break-all text-[var(--t-muted)] transition-colors hover:text-[var(--t-text)]"
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
