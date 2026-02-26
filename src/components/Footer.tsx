'use client';

import { useTranslation } from '@/i18n/useTranslation';

export function Footer() {
  const { t } = useTranslation();

  return (
    <footer className="py-12 px-4 sm:px-6 lg:px-8 border-t border-slate-200">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
        <span className="text-slate-600 text-sm">{t('footer.copyright')}</span>
        <div className="flex gap-6">
          <a href="#" className="text-slate-600 hover:text-slate-900 text-sm">
            {t('footer.privacy')}
          </a>
          <a href="#" className="text-slate-600 hover:text-slate-900 text-sm">
            {t('footer.terms')}
          </a>
        </div>
      </div>
    </footer>
  );
}
