'use client';

import { Suspense } from 'react';
import OnboardingPageContent from '@/components/OnboardingPageContent';

export default function ConnectPage() {
  return (
    <Suspense fallback={null}>
      <OnboardingPageContent />
    </Suspense>
  );
}
