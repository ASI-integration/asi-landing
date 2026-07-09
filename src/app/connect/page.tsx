'use client';

import { Suspense } from 'react';
import OnboardingPageContent from '../../components/OnboardingPageContent';
import { RuBottomQuickLinks } from '../../components/ru/RuBottomQuickLinks';
import { RuComplianceFooter } from '../../components/ru/RuComplianceFooter';
import { RuLegalTrustBlock } from '../../components/ru/RuLegalTrustBlock';

export default function ConnectPage() {
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
