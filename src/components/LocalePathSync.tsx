'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useLanguageContext } from '@/i18n/LanguageProvider';

/** Keep i18n dictionary aligned with URL: `/ru` → Russian, everything else → English. */
export function LocalePathSync() {
  const pathname = usePathname();
  const { setLocale } = useLanguageContext();

  useEffect(() => {
    if (pathname?.startsWith('/ru')) setLocale('ru');
    else setLocale('en');
  }, [pathname, setLocale]);

  return null;
}
