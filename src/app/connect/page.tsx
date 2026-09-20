import { redirect } from 'next/navigation';
import { getIsRuHost } from '@/lib/getIsRuHost';
import { Suspense } from 'react';
import OnboardingPageContent from '../../components/OnboardingPageContent';
import { RuBottomQuickLinks } from '../../components/ru/RuBottomQuickLinks';
import { RuComplianceFooter } from '../../components/ru/RuComplianceFooter';
import { RuLegalTrustBlock } from '../../components/ru/RuLegalTrustBlock';

export default async function ConnectPage({ searchParams = {} }: { searchParams?: Record<string, string | string[] | undefined> }) {
  if (await getIsRuHost()) {
    const params = new URLSearchParams();
    for (const key of ['redirect', 'google_error']) {
      const value = searchParams[key];
      if (typeof value === 'string') params.set(key, value);
    }
    redirect(`/ru/connect${params.size ? `?${params}` : ''}`);
  }
  return (
    <>
      <div className="flex-1 flex flex-col justify-center">
        <Suspense fallback={null}>
          <OnboardingPageContent />
        </Suspense>
      </div>
      <div className="w-full max-w-2xl mx-auto px-4 pb-4">
        <RuLegalTrustBlock tone="light" />
      </div>
      <RuBottomQuickLinks tone="light" />
      <RuComplianceFooter tone="light" />
    </>
  );
}
