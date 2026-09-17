import type { ReactNode } from 'react';

/**
 * Visual page foundation for ASI customer surfaces (ivory paper field).
 * Content/legal stay outside this shell.
 */
export function BrandPageShell({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-h-screen bg-asi-ivory text-asi-navy antialiased ${className}`.trim()}>
      {children}
    </div>
  );
}
