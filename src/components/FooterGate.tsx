'use client';

import { usePathname } from 'next/navigation';
import { LegalFooter } from '@/components/LegalFooter';
import { isRuPublicSurfacePath } from '@/config/ruSitePaths';

export function FooterGate({ isRuHost }: { isRuHost: boolean }) {
  const pathname = usePathname() || '';

  // Legacy `/ru/*` URLs redirect, but keep this guard for safety.
  if (pathname === '/ru' || pathname.startsWith('/ru/')) return null;

  // RU marketing, legal, and connect/report flows embed `RuComplianceFooter` (or equivalent).
  if (isRuHost && isRuPublicSurfacePath(pathname)) return null;

  return <LegalFooter ruSite={isRuHost} />;
}

