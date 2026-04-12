/**
 * RU marketing/legal pages served at the site root on asi-global.ru.
 * Middleware rewrites these URLs to `app/ru/*` internally; keep in sync with `middleware.ts`.
 */
export const RU_SITE_ROOT_REL_PATHS = [
  '/contacts',
  '/payment',
  '/refund',
  '/privacy',
  '/offer',
] as const;

export function isRuSiteRootPath(pathname: string): boolean {
  return (RU_SITE_ROOT_REL_PATHS as readonly string[]).includes(pathname);
}

/** RU public surfaces that use embedded RU footers / compliance (not the global `LegalFooter`). */
export function isRuPublicSurfacePath(pathname: string): boolean {
  if (pathname === '/' || pathname === '') return true;
  if (isRuSiteRootPath(pathname)) return true;
  if (pathname === '/connect' || pathname.startsWith('/connect/')) return true;
  if (pathname === '/report' || pathname.startsWith('/report/')) return true;
  return false;
}
