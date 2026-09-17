import type { ReactNode } from 'react';
import { asiBrandCardClasses } from '@/config/brand/tokens';

/** Shared paper card surface used by guestautopilot market/media cards. */
export function BrandCard({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`${asiBrandCardClasses.paper} ${className}`.trim()}>{children}</div>;
}
