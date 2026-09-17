import Link from 'next/link';
import { productSupportEmail } from '@/config/contact';
import { telegramSupportBotUrl } from '@/config/telegramBots';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';
import { RuBottomQuickLinks } from '@/components/ru/RuBottomQuickLinks';
import { RuComplianceFooter } from '@/components/ru/RuComplianceFooter';
import { TgIcon } from '@/components/TgIcon';
import {
  COMMUNICATION_PILOT_PRICE_RUB,
  COMMUNICATION_PILOT_SERVICE_TITLE,
} from '@/lib/payments/yookassa-env';

const NOW_ITEMS = [
  {
    title: 'AI-ответы гостям',
    desc: 'Типовые вопросы по заселению, Wi-Fi, правилам объекта и быту — в цифровых каналах.',
  },
  {
    title: 'Человек на исключениях',
    desc: 'Нестандартные ситуации уходят владельцу или оператору с контекстом переписки.',
  },
  {
    title: 'Пилот на один объект',
    desc: `${COMMUNICATION_PILOT_SERVICE_TITLE}: 1 объект, 1 месяц, ${COMMUNICATION_PILOT_PRICE_RUB} ₽.`,
  },
  {
    title: 'Оценка локации (отдельно)',
    desc: 'Проверка адреса по спросу и окружению — вспомогательный инструмент, не замена пилоту коммуникаций.',
  },
] as const;

const ROADMAP_ITEMS = [
  {
    title: 'Управление объявлениями и каналами',
    desc: 'Направление платформы: синхронизация и обновления по площадкам. Не входит в текущий пилот как готовая услуга.',
  },
  {
    title: 'Динамическое ценообразование',
    desc: 'Направление платформы: автоматическая подстройка тарифов. Сейчас в пилоте не продаётся как отдельный модуль.',
  },
  {
    title: 'Уборки, доступы, расписание',
    desc: 'Направление платформы: координация операционных задач. Не обещаем как текущую возможность пилота.',
  },
  {
    title: 'Отзывы и репутация',
    desc: 'Направление платформы. В пилоте фокус на гостевой переписке.',
  },
  {
    title: 'Финансовая отчётность',
    desc: 'Направление платформы: сводки и прогнозы. Не часть тарифа 1 объект / 1 месяц.',
  },
  {
    title: 'Мониторинг безопасности',
    desc: 'Направление платформы. Не заявляем как live-функцию закрытого пилота.',
  },
] as const;

export default function RuHowItWorksPage() {
  return (
    <ThemeProvider defaultTheme="light" className="theme-transition min-h-screen bg-[var(--t-bg)] text-[var(--t-text)]">
      <RuPublicNavHeader surface="theme" density="landing" />

      <main className="px-4 sm:px-6">
        <section className="mx-auto max-w-4xl pb-10 pt-14 sm:pb-14 sm:pt-18">
          <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.25em] text-[var(--t-muted)]">Сейчас и дорожная карта</p>
          <h1 className="text-3xl font-bold tracking-tight text-[var(--t-text)] sm:text-4xl">
            Как работает ASI
          </h1>
          <p className="mt-4 text-base leading-relaxed text-[var(--t-text-2)] sm:text-lg">
            Здесь разделены возможности <strong>текущего пилота</strong> и <strong>направление платформы</strong>. Платный
            MVP сейчас — AI-коммуникации для одного объекта на один месяц.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/ru/early-access"
              className="inline-flex items-center justify-center rounded-xl bg-[var(--t-accent)] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--t-accent-hover)]"
            >
              Подключить пилот →
            </Link>
            <Link
              href="/ru"
              className="inline-flex items-center justify-center rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] px-5 py-3 text-sm font-semibold transition-colors hover:bg-[var(--t-surface-2)]"
            >
              ← На главную
            </Link>
          </div>
        </section>

        <section className="mx-auto max-w-4xl border-t border-[var(--t-border)] py-12 sm:py-14">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--t-muted)]">Сейчас / пилот</p>
          <h2 className="mt-3 text-2xl font-bold text-[var(--t-text)] sm:text-3xl">Что доступно в закрытом пилоте</h2>
          <p className="mt-3 text-base leading-relaxed text-[var(--t-text-2)]">
            Фокус — рутинная переписка с гостями. Это не «полная автоматизация объекта на 99%».
          </p>
          <div className="mt-7 space-y-4">
            {NOW_ITEMS.map((item) => (
              <div key={item.title} className="rounded-2xl border border-[var(--t-border)] bg-[var(--t-surface)] p-6">
                <h3 className="font-semibold text-[var(--t-text)]">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--t-muted)]">{item.desc}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 rounded-2xl border border-[var(--t-border)] bg-[var(--t-surface-2)] p-6">
            <h3 className="font-semibold text-[var(--t-text)]">Пример: обращение ночью</h3>
            <p className="mt-2 text-sm leading-relaxed text-[var(--t-text-2)]">
              Гость пишет в 23:00 про Wi-Fi или заезд. В пилоте система отвечает по данным объекта. Если вопрос выходит за
              рамки типового сценария — подключается человек.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-4xl border-t border-[var(--t-border)] py-12 sm:py-14">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--t-muted)]">Дорожная карта платформы</p>
          <h2 className="mt-3 text-2xl font-bold text-[var(--t-text)] sm:text-3xl">Куда развивается ASI</h2>
          <p className="mt-3 text-base leading-relaxed text-[var(--t-text-2)]">
            Ниже — направление продукта. Эти пункты не продаются как готовые модули текущего пилота и не имеют сроков в
            публичном обещании.
          </p>
          <div className="mt-7 grid gap-4 sm:grid-cols-2">
            {ROADMAP_ITEMS.map((item) => (
              <div key={item.title} className="rounded-2xl border border-dashed border-[var(--t-border)] bg-[var(--t-surface)] p-6">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--t-muted)]">Roadmap</p>
                <h3 className="mt-2 font-semibold text-[var(--t-text)]">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--t-muted)]">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-4xl border-t border-[var(--t-border)] py-12 sm:py-14">
          <h2 className="text-2xl font-bold text-[var(--t-text)] sm:text-3xl">Следующий шаг</h2>
          <p className="mt-3 text-base leading-relaxed text-[var(--t-text-2)]">
            Чтобы участвовать в закрытом пилоте AI-ответов гостям, начните со страницы пилота и заявки.
          </p>
          <div className="mt-6">
            <Link
              href="/ru/early-access"
              className="inline-flex items-center justify-center rounded-xl bg-[var(--t-accent)] px-7 py-4 font-bold text-white transition-colors hover:bg-[var(--t-accent-hover)]"
            >
              Подключить пилот
            </Link>
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
