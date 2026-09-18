'use client';

import { usePathname } from 'next/navigation';
import { LegalFooter } from '@/components/LegalFooter';

export function FooterGate({ isRuHost }: { isRuHost: boolean }) {
  const pathname = usePathname() || '';

  // RU public pages own their footer (homepage serves at `/` on the RU host).
  if (pathname === '/ru' || pathname.startsWith('/ru/')) return null;
  if (isRuHost && (pathname === '/' || pathname === '')) return null;

  // On the RU site, `/connect` and `/report` already include `RuComplianceFooter`.
  if (isRuHost && (pathname === '/connect' || pathname.startsWith('/report'))) return null;

  // The international ASI Global marketing pages (guestautopilot.com) ship their own
  // footer (SiteFooter) and must not surface the RU-linked legal entity/contact block —
  // guestautopilot.com has no legal, contact, or corporate-data relationship to
  // asi-global.ru. Only applies on non-RU hosts; RU host still serves its own home at `/`.
  const isInternationalSitePage =
    !isRuHost && (pathname === '/' || pathname === '/markets/japan' || pathname === '/media');
  if (isInternationalSitePage) return null;

  return <LegalFooter ruSite={isRuHost} />;
}

