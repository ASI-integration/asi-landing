import type { Metadata } from 'next';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import OnboardingPageContent from '@/components/OnboardingPageContent';
import { BrandLogoMark, BrandPageShell } from '@/components/brand';
import { getSession, isSessionSecretConfigured } from '@/lib/auth';
import { safeAuthRedirectPath } from '@/lib/auth/app-url';
import { RU_SETUP_PATH } from '@/lib/rental-connect/model';

export const metadata: Metadata = { title: 'Подключение объекта — ASI', robots: { index: false, follow: true } };
export const dynamic = 'force-dynamic';

export default async function RuConnectPage({ searchParams }: { searchParams?: { redirect?: string } }) {
  if (isSessionSecretConfigured()) {
    const session = await getSession();
    if (session.userId) redirect(safeAuthRedirectPath(searchParams?.redirect || RU_SETUP_PATH));
  }
  return (
    <BrandPageShell>
      <header className="mx-auto max-w-2xl px-5 pt-7">
        <Link href="/ru" className="inline-flex items-center gap-3 text-lg font-serif"><BrandLogoMark size={28} /> ASI Global <span className="text-sm font-sans">← На главную</span></Link>
      </header>
      <main><Suspense fallback={<p className="p-8 text-center" role="status">Загружаем подключение…</p>}><OnboardingPageContent rental /></Suspense></main>
      <footer className="mx-auto max-w-2xl px-5 pb-8 flex flex-wrap gap-5 text-sm text-asi-navy/70">
        <Link href="/ru/privacy">Политика конфиденциальности</Link><Link href="/ru/offer">Оферта</Link><Link href="/ru/contacts">Помощь</Link>
      </footer>
    </BrandPageShell>
  );
}
