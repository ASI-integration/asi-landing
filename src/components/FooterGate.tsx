'use client';

import { usePathname } from 'next/navigation';
import { LegalFooter } from '@/components/LegalFooter';

export function FooterGate({ isRuHost }: { isRuHost: boolean }) {
  const pathname = usePathname() || '';

  // RU area and RU legal pages provide their own footer.
  if (pathname === '/ru' || pathname.startsWith('/ru/')) return null;

  // Dashboard screens are app workspaces; the public legal footer should not
  // appear inside the working area.
  if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) return null;

  // On the RU site, `/connect` and `/report` already include `RuComplianceFooter`.
  if (isRuHost && (pathname === '/connect' || pathname.startsWith('/report'))) return null;

  return <LegalFooter ruSite={isRuHost} />;
}

