'use client';

import Link from 'next/link';
import { useTranslation } from '@/i18n/useTranslation';

export function Footer() {
  const { t } = useTranslation();

  return (
    <footer className="py-12 px-4 sm:px-6 lg:px-8 border-t border-slate-200">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
        <span className="text-slate-600 text-sm">{t('footer.copyright')}</span>
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-1">
          <Link href="/privacy" className="text-slate-600 hover:text-slate-900 text-sm">
            {t('footer.privacyPolicy')}
          </Link>
          <Link href="/offer" className="text-slate-600 hover:text-slate-900 text-sm">
            {t('footer.terms')}
          </Link>
          <Link href="/legal" className="text-slate-600 hover:text-slate-900 text-sm">
            {t('footer.legalInfo')}
          </Link>
          <Link href="/offer" className="text-slate-600 hover:text-slate-900 text-sm">
            {t('footer.offer')}
          </Link>
        </div>
      </div>
    </footer>
  );
}
