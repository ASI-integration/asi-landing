'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslation } from '@/i18n/useTranslation';
import { SessionProvider, useSession } from '@/contexts/SessionContext';
import { DashboardAuthGuard } from '@/components/DashboardAuthGuard';

const navItems = [
  { href: '/dashboard', key: 'overview' },
  { href: '/dashboard/properties', key: 'properties' },
  { href: '/dashboard/automations', key: 'automations' },
  { href: '/dashboard/settings', key: 'settings' },
] as const;

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const pathname = usePathname();

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
      <aside
        className={`fixed left-0 top-0 bottom-0 w-60 bg-slate-900 flex flex-col z-50 transform transition-transform md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <Link href="/dashboard" className="px-6 py-5 text-xl font-bold text-white tracking-tight">
          ASI
        </Link>
        <nav className="flex-1 px-4 py-4 space-y-1">
          {navItems.map(({ href, key }) => {
            const isActive = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
            return (
              <Link
                key={key}
                href={href}
                onClick={onClose}
                className={`block px-4 py-2.5 text-sm font-medium rounded-md transition-colors ${
                  isActive
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-300 hover:bg-slate-800/50 hover:text-white'
                }`}
              >
                {t(`dashboard.sidebar.${key}`)}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

function Header({ onMenuClick }: { onMenuClick: () => void }) {
  const { t } = useTranslation();
  const { session } = useSession();
  const email = session?.user?.email ?? t('dashboard.header.userEmail');
  const initial = email.charAt(0).toUpperCase();

  return (
    <header className="h-[60px] bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-6">
      <button
        type="button"
        onClick={onMenuClick}
        className="md:hidden p-2 text-slate-600 hover:bg-slate-100 rounded-lg"
        aria-label="Menu"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <div className="flex-1 md:flex-none md:ml-auto flex items-center justify-end gap-3">
        <span className="text-sm text-slate-600 hidden sm:inline">{email}</span>
        <div className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 text-sm font-medium">
          {initial}
        </div>
      </div>
    </header>
  );
}

function DashboardLayoutInner({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <DashboardAuthGuard>
      <div className="min-h-screen bg-slate-50">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <div className="md:pl-60 min-h-screen flex flex-col">
          <Header onMenuClick={() => setSidebarOpen(true)} />
          <main className="flex-1 p-4 md:p-6">{children}</main>
        </div>
      </div>
    </DashboardAuthGuard>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SessionProvider>
      <DashboardLayoutInner>{children}</DashboardLayoutInner>
    </SessionProvider>
  );
}
