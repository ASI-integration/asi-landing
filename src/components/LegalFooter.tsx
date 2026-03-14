import Link from 'next/link';
import { legalFooterLine } from '@/config/legal';

export function LegalFooter() {
  return (
    <footer className="py-4 px-4 sm:px-6 border-t border-slate-200 bg-white">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-2 text-slate-600 text-sm">
        <span>{legalFooterLine}</span>
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-1">
          <Link href="/legal" className="hover:text-slate-900">
            Правовая информация
          </Link>
          <Link href="/offer" className="hover:text-slate-900">
            Публичная оферта
          </Link>
          <Link href="/privacy" className="hover:text-slate-900">
            Политика конфиденциальности
          </Link>
        </div>
      </div>
    </footer>
  );
}
