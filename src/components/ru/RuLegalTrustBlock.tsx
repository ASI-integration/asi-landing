import Link from 'next/link';
import { ruComplianceRoutes } from '@/config/ruCompliance';

type Tone = 'light' | 'dark';

export function RuLegalTrustBlock({ tone = 'light' }: { tone?: Tone }) {
  const box =
    tone === 'light'
      ? 'rounded-xl border border-slate-200 bg-white px-4 py-4 sm:px-5 sm:py-5'
      : 'rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-4 sm:px-5 sm:py-5';
  const title =
    tone === 'light' ? 'text-sm font-semibold text-slate-900' : 'text-sm font-semibold text-white';
  const link =
    tone === 'light'
      ? 'text-sm text-slate-700 hover:text-slate-900 underline-offset-2 hover:underline'
      : 'text-sm text-slate-300 hover:text-white underline-offset-2 hover:underline';

  return (
    <aside className={box} aria-label="Правовая информация">
      <h2 className={title}>Правовая информация</h2>
      <ul className="mt-3 space-y-2">
        <li>
          <Link href={ruComplianceRoutes.contacts} className={link}>
            Правовые документы
          </Link>
        </li>
        <li>
          <Link href={ruComplianceRoutes.payment} className={link}>
            Условия оплаты
          </Link>
        </li>
        <li>
          <Link href={ruComplianceRoutes.refund} className={link}>
            Возврат и отказ
          </Link>
        </li>
        <li>
          <Link href={ruComplianceRoutes.privacy} className={link}>
            Конфиденциальность
          </Link>
        </li>
        <li>
          <Link href={ruComplianceRoutes.offer} className={link}>
            Условия
          </Link>
        </li>
      </ul>
    </aside>
  );
}
