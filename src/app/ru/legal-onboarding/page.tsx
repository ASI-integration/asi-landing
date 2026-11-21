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
  isRuLegalAcceptancePersistenceEnabled,
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

  // Localization review and its RLS-protected evidence tables must be ready
  // before asking a real customer to accept legally significant documents.
  // Do not show an acceptance form that will fail or silently lose evidence.
  if (!isRuLegalAcceptancePersistenceEnabled()) return <LegalGateUnavailable />;

  let state: Awaited<ReturnType<typeof getRuLegalOnboardingStateForUser>>;
  try {
    state = await getRuLegalOnboardingStateForUser(session.userId);
  } catch (error) {
    console.error('[ru-legal-onboarding] evidence store unavailable', error instanceof Error ? error.name : 'unknown');
    return <LegalGateUnavailable />;
  }
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

function LegalGateUnavailable() {
  return (
    <BrandPageShell>
      <header className="mx-auto max-w-2xl px-5 pt-7">
        <Link href="/ru" className="inline-flex items-center gap-3 font-serif text-lg text-asi-navy">
          <BrandLogoMark size={28} /> ASI Global
        </Link>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-10 sm:py-14">
        <div role="status" className="border border-asi-border bg-asi-paper p-7 sm:p-10">
          <h1 className="font-serif text-3xl text-asi-navy">Подключение пока ожидает подтверждения</h1>
          <p className="mt-5 text-base leading-relaxed text-asi-navy/75">
            Регистрация и демонстрация доступны. Юридическое подключение временно
            приостановлено до проверки условий и защищённого хранения подтверждений.
            Договор, бесплатный пилот и платное обслуживание автоматически не начинаются.
          </p>
          <Link href="/ru/contacts" className="mt-6 inline-block text-sm font-semibold text-asi-navy underline underline-offset-4">
            Связаться с поддержкой
          </Link>
        </div>
      </main>
      <footer><RuComplianceFooter tone="theme" variant="compact" /></footer>
    </BrandPageShell>
  );
}
