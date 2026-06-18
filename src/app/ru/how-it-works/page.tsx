import Link from 'next/link';
import { productSupportEmail } from '@/config/contact';
import { buildAsiFeedbackTelegramLink } from '@/config/publicTelegram';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';
import { RuBottomQuickLinks } from '@/components/ru/RuBottomQuickLinks';
import { RuComplianceFooter } from '@/components/ru/RuComplianceFooter';
import { TgIcon } from '@/components/TgIcon';

const AUTOMATED_ITEMS = [
  {
    title: 'Коммуникация с гостями',
    desc: 'ИИ отвечает мгновенно, 24/7 — заменяет стойку и мониторинг почты.',
  },
  {
    title: 'Управление объявлениями',
    desc: 'Создание, обновления и синхронизация по каналам — заменяет администратора листингов.',
  },
  {
    title: 'Ценообразование',
    desc: 'Автоматически подстраивается под сигналы спроса — заменяет ручной тарифный стол.',
  },
  {
    title: 'Обработка бронирований',
    desc: 'Подтверждения и календарь исполняются автоматически — заменяет координатора броней.',
  },
  {
    title: 'Отзывы',
    desc: 'Запросы и ответы по политике — заменяет ручную работу с репутацией.',
  },
  {
    title: 'Инциденты и вопросы',
    desc: 'ИИ доводит большинство кейсов до решения — заменяет первую линию поддержки.',
  },
  {
    title: 'Синхронизация каналов',
    desc: 'Работает с площадками; заменяет менеджеров каналов и табличный операционный контур.',
  },
  {
    title: 'Финансовый учёт',
    desc: 'Доход, показатели и прогнозы собираются автоматически — заменяет операционную отчётность.',
  },
] as const;

const EXECUTION_LAYER = [
  {
    title: 'Коммуникация с гостями',
    body: 'Ведёт входящие обращения гостей круглосуточно — без задержек и пропущенных тредов.',
  },
  {
    title: 'Сбор данных и приём заявок',
    body: 'Исполняет квалификацию и сбор данных целиком — заменяет сотрудника на приёме.',
  },
  {
    title: 'Рабочие процессы и расписание',
    body: 'Коды доступа, уборка, повторяющиеся задачи — система выполняет и закрывает автоматически.',
  },
  {
    title: 'Платежи и монетизация',
    body: 'Доплаты, поздний выезд, дополнительные услуги — счёт в чате, оплата в один клик.',
  },
  {
    title: 'Динамическое ценообразование',
    body: 'Тарифы двигаются со спросом, конкурентами и загрузкой — без ревеню-менеджера в контуре.',
  },
  {
    title: 'Редкий вызов оператора',
    body: 'Истинные исключения уходят человеку с полным контекстом. Всё остальное исполняется автоматически.',
  },
  {
    title: 'Безопасность и контроль доступа',
    body: 'Мониторинг в реальном времени, контроль доступа, обнаружение инцидентов и автоматические сценарии реагирования.',
  },
] as const;

export default function RuHowItWorksPage() {
  return (
    <ThemeProvider defaultTheme="light" className="theme-transition min-h-screen bg-[var(--t-bg)] text-[var(--t-text)]">
      <RuPublicNavHeader surface="theme" density="landing" />

      <main className="px-4 sm:px-6">
        <section className="max-w-4xl mx-auto pt-14 sm:pt-18 pb-10 sm:pb-14">
          <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-[var(--t-muted)] mb-4">
            Детали
          </p>
          <h1 className="text-3xl sm:text-4xl font-bold text-[var(--t-text)] tracking-tight">
            Как работает ASI (платформа и сценарии)
          </h1>
          <p className="mt-4 text-[var(--t-text-2)] text-base sm:text-lg leading-relaxed">
            Это страница с более подробным описанием. Здесь будет удобно добавлять демо-видео, расширенные объяснения и сравнения.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/ru"
              className="inline-flex items-center justify-center px-5 py-3 rounded-xl border border-[var(--t-border)] bg-[var(--t-surface)] hover:bg-[var(--t-surface-2)] transition-colors text-sm font-semibold"
            >
              ← На главную
            </Link>
            <Link
              href="/connect"
              className="inline-flex items-center justify-center px-5 py-3 rounded-xl bg-[var(--t-accent)] text-white font-semibold text-sm hover:bg-[var(--t-accent-hover)] transition-colors"
            >
              Запросить подключение →
            </Link>
          </div>
        </section>

        <section className="max-w-4xl mx-auto py-12 sm:py-14 border-t border-[var(--t-border)]">
          <h2 className="text-2xl sm:text-3xl font-bold text-[var(--t-text)]">
            Почему ASI уже сейчас
          </h2>
          <p className="mt-3 text-[var(--t-text-2)] text-base sm:text-lg leading-relaxed">
            Два модуля уже работают. Ниже — конкретные ситуации, в которых они применяются прямо сейчас.
          </p>

          <div className="mt-7 space-y-6">
            <div className="rounded-2xl border border-[var(--t-border)] bg-[var(--t-surface)] p-6">
              <p className="text-xs font-semibold uppercase tracking-widest text-[var(--t-muted)]">
                Сценарий 1
              </p>
              <h3 className="mt-2 font-bold text-[var(--t-text)] text-base">
                Обращение в нерабочее время
              </h3>
              <p className="mt-2 text-sm text-[var(--t-text-2)] leading-relaxed">
                Гость пишет в 23:00. Без системы — обращение висит до утра. С ASI — ответ уходит сразу, данные собраны, сценарий продолжается без участия оператора.
              </p>
            </div>

            <div className="rounded-2xl border border-[var(--t-border)] bg-[var(--t-surface)] p-6">
              <p className="text-xs font-semibold uppercase tracking-widest text-[var(--t-muted)]">
                Сценарий 2
              </p>
              <h3 className="mt-2 font-bold text-[var(--t-text)] text-base">
                Объект недозагружен
              </h3>
              <p className="mt-2 text-sm text-[var(--t-text-2)] leading-relaxed">
                Заполняемость падает, причина неочевидна. Модуль оценки локации показывает, где именно объект теряет: спрос в зоне, конкуренты, магниты трафика рядом.
              </p>
            </div>

            <div className="rounded-2xl border border-[var(--t-border)] bg-[var(--t-surface)] p-6">
              <p className="text-xs font-semibold uppercase tracking-widest text-[var(--t-muted)]">
                Сценарий 3
              </p>
              <h3 className="mt-2 font-bold text-[var(--t-text)] text-base">
                Оператор работает с портфелем
              </h3>
              <p className="mt-2 text-sm text-[var(--t-text-2)] leading-relaxed">
                Несколько объектов — разные чаты, задачи, аналитика по каждому. ASI сводит входящие обращения, доступы и видимость по доходности в единый рабочий контур.
              </p>
            </div>
          </div>
        </section>

        <section className="max-w-4xl mx-auto py-12 sm:py-14 border-t border-[var(--t-border)]">
          <h2 className="text-2xl sm:text-3xl font-bold text-[var(--t-text)]">
            Что автоматизируется в ASI
          </h2>
          <p className="mt-3 text-[var(--t-text-2)] text-base sm:text-lg leading-relaxed">
            Конкретные операционные функции — не обещания. Система исполняет их без участия команды.
          </p>

          <div className="mt-7 rounded-2xl border border-[var(--t-border)] bg-[var(--t-surface)] p-6">
            <ul className="space-y-4">
              {AUTOMATED_ITEMS.map((item) => (
                <li key={item.title} className="flex flex-col gap-1">
                  <p className="font-semibold text-[var(--t-text)]">{item.title}</p>
                  <p className="text-sm text-[var(--t-muted)] leading-relaxed">{item.desc}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="max-w-4xl mx-auto py-12 sm:py-14 border-t border-[var(--t-border)]">
          <h2 className="text-2xl sm:text-3xl font-bold text-[var(--t-text)]">
            Не CRM, не channel manager, не PMS
          </h2>
          <p className="mt-3 text-[var(--t-text-2)] text-base sm:text-lg leading-relaxed">
            Все эти инструменты требуют операторов, которые их используют. ASI — это слой исполнения: система сама ведёт операции от начала до конца.
          </p>

          <div className="mt-7 grid gap-4">
            {[
              {
                label: 'CRM',
                gap: 'Фиксирует данные. Требует оператора, который с ними работает.',
              },
              {
                label: 'Channel manager',
                gap: 'Синхронизирует площадки. Не ведёт коммуникацию и не принимает решений.',
              },
              {
                label: 'PMS',
                gap: 'Управляет объектами. Не обрабатывает гостей и не закрывает инциденты.',
              },
              {
                label: 'Точечная автоматизация',
                gap: 'Закрывает одну функцию. Остальные всё равно требуют ручного труда.',
              },
            ].map((item) => (
              <div key={item.label} className="rounded-2xl border border-[var(--t-border)] bg-[var(--t-surface)] p-6">
                <p className="text-sm font-semibold text-[var(--t-text)]">{item.label}</p>
                <p className="mt-2 text-sm text-[var(--t-muted)] leading-relaxed">
                  {item.gap}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-2xl border-2 border-[color:var(--t-accent)] bg-[color-mix(in_srgb,var(--t-accent)_8%,var(--t-surface))] p-6">
            <p className="font-bold text-[var(--t-text)] text-base">
              ASI — операционный слой
            </p>
            <p className="mt-2 text-sm text-[var(--t-text-2)] leading-relaxed">
              Заменяет операционный контур целиком: принимает обращения, ведёт гостей, исполняет задачи, контролирует платежи и доступы — без команды операторов в цепочке.
            </p>
          </div>
        </section>

        <section className="max-w-4xl mx-auto py-12 sm:py-14 border-t border-[var(--t-border)]">
          <h2 className="text-2xl sm:text-3xl font-bold text-[var(--t-text)]">
            Слой исполнения
          </h2>
          <p className="mt-3 text-[var(--t-muted)] text-base sm:text-lg leading-relaxed">
            Работа, которая лежала на операционном отделе, — система ведёт от начала до конца.
          </p>

          <div className="mt-7 grid sm:grid-cols-2 gap-4">
            {EXECUTION_LAYER.map((item) => (
              <div key={item.title} className="rounded-2xl border border-[var(--t-border)] bg-[var(--t-surface)] p-6">
                <h3 className="font-semibold text-[var(--t-text)] text-base">
                  {item.title}
                </h3>
                <p className="mt-2 text-sm text-[var(--t-muted)] leading-relaxed">
                  {item.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="max-w-4xl mx-auto py-12 sm:py-14 border-t border-[var(--t-border)]">
          <h2 className="text-2xl sm:text-3xl font-bold text-[var(--t-text)]">
            Следующие шаги
          </h2>
          <p className="mt-3 text-[var(--t-text-2)] text-base sm:text-lg leading-relaxed">
            Эту страницу можно расширять без перегруза главной: добавить демо-видео, подробное описание модулей и интеграций, а также большие сравнения и кейсы.
          </p>
          <div className="mt-6">
            <Link
              href="/connect"
              className="inline-flex items-center justify-center px-7 py-4 rounded-xl bg-[var(--t-accent)] text-white font-bold hover:bg-[var(--t-accent-hover)] transition-colors"
            >
              Запросить разбор объектов
            </Link>
          </div>
        </section>
      </main>

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
                href={buildAsiFeedbackTelegramLink('site')}
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

