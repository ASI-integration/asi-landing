import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { BrandLogoMark, BrandPageShell } from '@/components/brand';
import { RuLegalOnboardingClient } from '@/components/ru/RuLegalOnboardingClient';
import { RuComplianceFooter } from '@/components/ru/RuComplianceFooter';
import { getSession, isSessionSecretConfigured } from '@/lib/auth';
import {
  RU_OFFER_DOCUMENT,
  RU_PD_CONSENT_DOCUMENT,
  getRuLegalOnboardingStateForUser,
} from '@/lib/ru-legal';
import { RU_SETUP_PATH } from '@/lib/rental-connect/model';

export const metadata: Metadata = {
  title: 'Юридическое подключение — ASI',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

export default async function RuLegalOnboardingPage() {
  if (!isSessionSecretConfigured()) redirect('/ru/connect?redirect=%2Fru%2Flegal-onboarding');
  const session = await getSession();
  if (!session.userId) redirect('/ru/connect?redirect=%2Fru%2Flegal-onboarding');

  const state = await getRuLegalOnboardingStateForUser(session.userId);
  if (!state) redirect('/ru/connect?redirect=%2Fru%2Flegal-onboarding');
  if (state.complete) redirect(RU_SETUP_PATH);

  return (
    <BrandPageShell>
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 pt-7 sm:px-8">
        <Link href="/ru" className="inline-flex items-center gap-3 font-serif text-lg text-asi-navy">
          <BrandLogoMark size={30} /> ASI Global
        </Link>
        <span className="text-sm text-asi-navy/60">Юридическое подключение</span>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-10 sm:px-8 sm:py-14">
        <RuLegalOnboardingClient
          initialState={state}
          offer={RU_OFFER_DOCUMENT}
          consent={RU_PD_CONSENT_DOCUMENT}
        />
      </main>
      <footer><RuComplianceFooter tone="theme" variant="compact" /></footer>
    </BrandPageShell>
  );
}
