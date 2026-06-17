'use client';

import { PilotDashboardOnboardingBlock } from '@/components/PilotDashboardOnboardingBlock';
import { usePilotContactId } from '@/hooks/usePilotContactId';
import { shouldShowDashboardPilotBlock } from '@/lib/crm/pilot-onboarding';

type PilotPropertyOnboardingSectionProps = {
  properties: Array<{
    id: string;
    city?: string | null;
    address?: string | null;
    guestReadinessReady?: boolean;
  }>;
  propertyId?: string;
  context: 'list' | 'detail' | 'setup';
};

export function PilotPropertyOnboardingSection({
  properties,
  propertyId,
  context,
}: PilotPropertyOnboardingSectionProps) {
  const crmContactId = usePilotContactId();

  if (!shouldShowDashboardPilotBlock({ crmContactId, propertyId })) {
    return null;
  }

  return (
    <PilotDashboardOnboardingBlock
      crmContactId={crmContactId}
      properties={properties}
      propertyId={propertyId}
      context={context}
    />
  );
}
