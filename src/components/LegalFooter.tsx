'use client';

import Link from 'next/link';
import { legalFooterLine } from '@/config/legal';
import { useTranslation } from '@/i18n/useTranslation';

export function LegalFooter() {
  const { t, locale } = useTranslation();

  const links = (
    <div className="flex flex-wrap justify-center gap-x-6 gap-y-1">
      <Link href="/legal" className="hover:text-slate-900">
        {t('footer.legalInfo')}
      </Link>
      <Link href="/offer" className="hover:text-slate-900">
        {t('footer.offer')}
      </Link>
      <Link href="/privacy" className="hover:text-slate-900">
        {t('footer.privacyPolicy')}
      </Link>
    </div>
  );

  return (
    <footer className="py-4 px-4 sm:px-6 border-t border-slate-200 bg-white">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-2 text-slate-600 text-sm">
        {locale === 'ru' ? (
          <>
            <span>{legalFooterLine}</span>
            {links}
          </>
        ) : (
          <div className="w-full flex justify-center sm:justify-end">{links}</div>
        )}
      </div>
    </footer>
  );
}
