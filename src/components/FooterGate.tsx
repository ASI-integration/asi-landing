'use client';

import { usePathname } from 'next/navigation';
import { LegalFooter } from '@/components/LegalFooter';

export function FooterGate({ isRuHost }: { isRuHost: boolean }) {
  const pathname = usePathname() || '';

  // RU area and RU legal pages provide their own footer.
  if (pathname === '/ru' || pathname.startsWith('/ru/')) return null;

  // On the RU site, `/connect` and `/report` already include `RuComplianceFooter`.
  if (isRuHost && (pathname === '/connect' || pathname.startsWith('/report'))) return null;

  return <LegalFooter ruSite={isRuHost} />;
}

