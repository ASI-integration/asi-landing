'use client';

import Link from 'next/link';
import { useTranslation } from '@/i18n/useTranslation';
import { useLanguageContext } from '@/i18n/LanguageProvider';
import { ruComplianceRoutes } from '@/config/ruCompliance';

export function Footer() {
  const { t } = useTranslation();
  const { locale } = useLanguageContext();
  const linkClass = 'text-slate-600 hover:text-slate-900 text-sm';

  return (
    <footer className="py-12 px-4 sm:px-6 lg:px-8 border-t border-slate-200">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
        <span className="text-slate-600 text-sm">{t('footer.copyright')}</span>
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-1">
          {locale === 'ru' ? (
            <>
              <Link href={ruComplianceRoutes.contacts} className={linkClass}>
                Правовые документы
              </Link>
              <Link href={ruComplianceRoutes.payment} className={linkClass}>
                Оплата
              </Link>
              <Link href={ruComplianceRoutes.refund} className={linkClass}>
                Возврат
              </Link>
              <Link href={ruComplianceRoutes.privacy} className={linkClass}>
                Конфиденциальность
              </Link>
              <Link href={ruComplianceRoutes.offer} className={linkClass}>
                Условия
              </Link>
            </>
          ) : (
            <>
              <Link href="/privacy" className={linkClass}>
                {t('footer.privacyPolicy')}
              </Link>
              <Link href="/offer" className={linkClass}>
                {t('footer.offer')}
              </Link>
              <Link href="/legal" className={linkClass}>
                {t('footer.legalInfo')}
              </Link>
            </>
          )}
        </div>
      </div>
    </footer>
  );
}
