'use client';

import { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTranslation } from '@/i18n/useTranslation';
import { SessionProvider, useSession } from '@/contexts/SessionContext';
import { DashboardAuthGuard } from '@/components/DashboardAuthGuard';

type DashboardNavItem = {
  href: string;
  key: string;
  label?: string;
  internalOnly?: boolean;
};

const navItems: readonly DashboardNavItem[] = [
  { href: '/dashboard', key: 'overview' },
  { href: '/dashboard/leads', key: 'leads', label: 'Заявки', internalOnly: true },
  { href: '/dashboard/reports', key: 'reports' },
  { href: '/dashboard/channel-connections', key: 'channelConnections' },
  { href: '/dashboard/channel-manager', key: 'channelManager' },
  { href: '/dashboard/properties', key: 'properties' },
  { href: '/dashboard/communication', key: 'communication' },
  { href: '/dashboard/operations', key: 'operations' },
  { href: '/dashboard/bookings', key: 'bookings' },
  { href: '/dashboard/automations', key: 'automations' },
  { href: '/dashboard/settings', key: 'settings' },
];

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const { session } = useSession();
  const visibleNavItems = navItems.filter((item) => !('internalOnly' in item && item.internalOnly) || session?.isInternal);

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
        <Link
          href="/ru"
          className="mx-3 mt-3 mb-1 rounded-lg px-3 py-3 inline-flex items-center text-3xl font-bold text-white tracking-tight cursor-pointer transition-colors hover:bg-slate-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
          onClick={onClose}
        >
          ASI
        </Link>
        <nav className="flex-1 px-4 py-4 space-y-1.5">
          {visibleNavItems.map(({ href, key, label }) => {
            const isActive = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
            return (
              <Link
                key={key}
                href={href}
                onClick={onClose}
                className={`block rounded-md px-4 py-3.5 text-[15px] font-medium leading-6 transition-colors ${
                  isActive
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:bg-slate-800/50 hover:text-white'
                }`}
              >
                {label ?? t(`dashboard.sidebar.${key}`)}
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
  const router = useRouter();
  const { session, refresh } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const email = session?.user?.email ?? t('dashboard.header.userEmail');
  const initial = email.charAt(0).toUpperCase();

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [menuOpen]);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      if (!res.ok) return;
      await refresh();
      setMenuOpen(false);
      router.replace('/');
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <header className="h-[60px] bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-6 relative z-30">
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
      <div className="flex-1 md:flex-none md:ml-auto flex items-center justify-end">
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="w-9 h-9 rounded-full bg-slate-200 flex items-center justify-center text-slate-600 text-sm font-medium hover:bg-slate-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label={t('dashboard.header.userMenu')}
          >
            {initial}
          </button>
          {menuOpen ? (
            <div
              role="menu"
              aria-orientation="vertical"
              className="absolute right-0 top-full mt-2 w-64 rounded-xl border border-slate-200 bg-white shadow-lg py-1 z-50"
            >
              <div className="px-4 py-3 text-sm text-slate-700 border-b border-slate-100 break-all" role="none">
                {email}
              </div>
              <button
                type="button"
                role="menuitem"
                disabled={loggingOut}
                onClick={handleLogout}
                className="w-full text-left px-4 py-2.5 text-sm font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-50"
              >
                {t('dashboard.header.logout')}
              </button>
            </div>
          ) : null}
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
