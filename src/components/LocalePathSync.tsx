'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useLanguageContext } from '@/i18n/LanguageProvider';

/**
 * Keep i18n dictionary aligned with URL:
 * `/ru` and the owner cabinet (`/dashboard`) → Russian, everything else → English.
 * The cabinet is RU-only, so it must never fall back to the English dictionary.
 */
export function LocalePathSync() {
  const pathname = usePathname();
  const { setLocale } = useLanguageContext();

  useEffect(() => {
    if (pathname?.startsWith('/ru') || pathname?.startsWith('/dashboard')) setLocale('ru');
    else setLocale('en');
  }, [pathname, setLocale]);

  return null;
}
