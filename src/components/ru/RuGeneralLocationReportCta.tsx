import Link from 'next/link';

type RuGeneralLocationReportCtaProps = {
  primaryHref: string;
  secondaryHref?: string;
  id?: string;
  tone?: 'default' | 'muted';
};

export function RuGeneralLocationReportCta({
  primaryHref,
  secondaryHref = '/login',
  id,
  tone = 'muted',
}: RuGeneralLocationReportCtaProps) {
  return (
    <section
      id={id}
      className={`scroll-mt-20 border-t border-[var(--t-border)] px-4 py-16 sm:px-6 sm:py-20 ${
        tone === 'muted' ? 'bg-[var(--t-surface-2)]' : 'bg-[var(--t-bg)]'
      }`}
    >
      <div className="mx-auto max-w-4xl">
        <div className="max-w-3xl">
          <h2 className="text-3xl font-bold tracking-tight text-[var(--t-text)] sm:text-4xl">
            Получите отчёт по локации
          </h2>
          <p className="mt-4 text-lg leading-relaxed text-[var(--t-text-2)]">
            Введите адрес — ASI покажет общий вывод по объекту: насколько место подходит для посуточной аренды и какие факторы рядом влияют на спрос.
          </p>
          <p className="mt-4 text-lg leading-relaxed text-[var(--t-text-2)]">
            Если нужен полный разбор, подробный отчёт можно заказать в личном кабинете: конкуренты, риски, стратегия запуска и прогноз развития района.
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Link
            href={primaryHref}
            className="inline-flex min-h-[52px] items-center justify-center rounded-xl bg-[var(--t-accent)] px-6 py-3 text-base font-bold text-white transition-colors hover:bg-[var(--t-accent-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--t-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--t-surface-2)]"
          >
            Получить общий отчёт
          </Link>
          <Link
            href={secondaryHref}
            className="inline-flex min-h-[52px] items-center justify-center rounded-xl border border-[var(--t-border)] px-6 py-3 text-base font-bold text-[var(--t-text)] transition-colors hover:bg-[var(--t-bg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--t-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--t-surface-2)]"
          >
            Заказать подробный отчёт
          </Link>
        </div>
      </div>
    </section>
  );
}
