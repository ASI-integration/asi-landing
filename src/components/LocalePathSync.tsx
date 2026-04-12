'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useLanguageContext } from '@/i18n/LanguageProvider';
import { isRuPublicSurfacePath } from '@/config/ruSitePaths';

/** Keep i18n dictionary aligned with URL and host (asi-global.ru public pages → Russian). */
export function LocalePathSync() {
  const pathname = usePathname();
  const { setLocale } = useLanguageContext();

  useEffect(() => {
    const hostRu = typeof window !== 'undefined' && window.location.hostname.endsWith('.ru');
    if (pathname?.startsWith('/ru')) setLocale('ru');
    else if (hostRu && pathname && isRuPublicSurfacePath(pathname)) setLocale('ru');
    else setLocale('en');
  }, [pathname, setLocale]);

  return null;
}
