import type { ReactNode } from 'react';
import { RuPublicNavHeader } from '@/components/ru/RuPublicNavHeader';

export default function ConnectLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <RuPublicNavHeader surface="light" density="legal" />
      {children}
    </div>
  );
}
