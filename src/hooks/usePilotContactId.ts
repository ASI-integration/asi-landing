'use client';

import { useEffect, useState } from 'react';
import { readStoredPilotContactId, rememberPilotContactId } from '@/lib/crm/pilot-onboarding';

export function usePilotContactId(): string | null {
  const [crmContactId, setCrmContactId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('crmContactId')?.trim();
    if (fromUrl) {
      rememberPilotContactId(fromUrl);
      setCrmContactId(fromUrl);
      return;
    }
    setCrmContactId(readStoredPilotContactId());
  }, []);

  return crmContactId;
}
