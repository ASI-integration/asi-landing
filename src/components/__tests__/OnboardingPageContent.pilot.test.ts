import { describe, expect, it } from 'vitest';
import { isPilotConnectRedirect } from '@/lib/crm/pilot-onboarding';

describe('/connect pilot redirect copy gate', () => {
  it('enables pilot connect copy for properties redirect', () => {
    expect(isPilotConnectRedirect('/dashboard/properties')).toBe(true);
    expect(
      isPilotConnectRedirect(
        '/dashboard/properties?crmContactId=6c9f99b1-726c-4fcf-d428-bcb23d84df20',
      ),
    ).toBe(true);
    expect(isPilotConnectRedirect('/dashboard')).toBe(false);
    expect(isPilotConnectRedirect('/connect')).toBe(false);
  });
});
