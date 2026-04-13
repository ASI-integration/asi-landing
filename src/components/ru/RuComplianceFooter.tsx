import Link from 'next/link';
import { ruCompliance, ruComplianceRoutes } from '@/config/ruCompliance';

const linkBase =
  'text-sm text-[var(--t-muted)] hover:text-[var(--t-text)] underline-offset-2 hover:underline transition-colors';
const linkBaseLight = 'text-sm text-slate-600 hover:text-slate-900 underline-offset-2 hover:underline transition-colors';
const linkBaseDark = 'text-sm text-slate-400 hover:text-white underline-offset-2 hover:underline transition-colors';

type Tone = 'theme' | 'light' | 'dark';

export function RuComplianceFooter({ tone = 'theme' }: { tone?: Tone }) {
  const link = tone === 'light' ? linkBaseLight : tone === 'dark' ? linkBaseDark : linkBase;
  const heading =
    tone === 'light'
      ? 'text-xs font-semibold uppercase tracking-[0.2em] text-slate-500'
      : tone === 'dark'
        ? 'text-xs font-semibold uppercase tracking-[0.2em] text-slate-500'
        : 'text-xs font-semibold uppercase tracking-[0.2em] text-[var(--t-muted)]';
  const contactLine =
    tone === 'light'
      ? 'text-sm text-slate-700'
      : tone === 'dark'
        ? 'text-sm text-slate-300'
        : 'text-sm text-[var(--t-text-2)]';
  const req =
    tone === 'light'
      ? 'text-xs text-slate-600 leading-relaxed'
      : tone === 'dark'
        ? 'text-xs text-slate-400 leading-relaxed'
        : 'text-xs text-[var(--t-muted)] leading-relaxed';
  const border =
    tone === 'light'
      ? 'border-t border-slate-200 bg-slate-50'
      : tone === 'dark'
        ? 'border-t border-slate-800 bg-slate-950'
        : 'border-t border-[var(--t-border)] bg-[var(--t-bg)]';

  return (
    <footer className={`${border} py-8 px-4 sm:px-6`}>
      <div className="max-w-6xl mx-auto flex flex-col gap-6">
        <p className={contactLine}>
          <span className="font-medium">Связаться с нами:</span>{' '}
          <a
            href={`mailto:${ruCompliance.email}`}
            className={
              tone === 'light'
                ? 'text-slate-900 underline underline-offset-2 hover:text-slate-700'
                : tone === 'dark'
                  ? 'text-white underline underline-offset-2 hover:text-slate-200'
                  : 'text-[var(--t-text)] underline underline-offset-2 hover:text-[var(--t-muted)]'
            }
          >
            {ruCompliance.email}
          </a>
        </p>

        <div>
          <h2 className={heading}>Документы и контакты</h2>
          <nav className="mt-3 flex flex-col sm:flex-row sm:flex-wrap gap-x-6 gap-y-2" aria-label="Правовая информация">
            <Link href={ruComplianceRoutes.contacts} className={link}>
              Правовые документы
            </Link>
            <Link href={ruComplianceRoutes.payment} className={link}>
              Оплата
            </Link>
            <Link href={ruComplianceRoutes.refund} className={link}>
              Возврат
            </Link>
            <Link href={ruComplianceRoutes.privacy} className={link}>
              Конфиденциальность
            </Link>
            <Link href={ruComplianceRoutes.offer} className={link}>
              Условия
            </Link>
          </nav>
        </div>

        <div className={`pt-4 border-t ${tone === 'light' ? 'border-slate-200' : tone === 'dark' ? 'border-slate-800' : 'border-[var(--t-border)]'}`}>
          <p className={req}>
            Самозанятый: {ruCompliance.fullName}
            <br />
            ИНН: {ruCompliance.inn}
          </p>
        </div>
      </div>
    </footer>
  );
}
