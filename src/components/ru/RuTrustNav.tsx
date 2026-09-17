'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ruComplianceRoutes } from '@/config/ruCompliance';

const TRUST_NAV = [
  { href: ruComplianceRoutes.payment, label: 'Оплата' },
  { href: ruComplianceRoutes.offer, label: 'Оферта' },
  { href: ruComplianceRoutes.refund, label: 'Возврат' },
  { href: ruComplianceRoutes.privacy, label: 'Политика данных' },
  { href: ruComplianceRoutes.contacts, label: 'Контакты' },
] as const;

/**
 * Compact RU document switcher for compliance/trust pages.
 * Routes come from `ruComplianceRoutes` only.
 */
export function RuTrustNav({ className = '' }: { className?: string }) {
  const pathname = usePathname() ?? '';

  return (
    <nav
      aria-label="Документы и условия"
      className={`flex flex-wrap gap-x-1 gap-y-2 border-y border-asi-border py-3 ${className}`.trim()}
    >
      {TRUST_NAV.map((item) => {
        const active = Boolean(pathname) && pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`px-3 py-1.5 text-xs sm:text-sm font-sans tracking-wide transition-colors rounded-sm ${
              active
                ? 'bg-asi-navy text-asi-ivory'
                : 'text-asi-navy/70 hover:text-asi-navy hover:bg-asi-paper'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
