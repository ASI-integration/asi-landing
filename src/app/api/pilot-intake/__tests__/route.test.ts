import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedPilotApplication } from '@/lib/crm/pilot-intake';

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('/api/pilot-intake', () => {
  it('normalizes and saves a pilot application', async () => {
    const upsertPilotApplication = vi.fn(async (input: NormalizedPilotApplication) => ({
      id: 'contact-1',
      nextAction: input.suggestedNextAction,
    }));

    vi.doMock('@/lib/crm/pilot-intake', async () => {
      const actual = await vi.importActual<typeof import('@/lib/crm/pilot-intake')>('@/lib/crm/pilot-intake');
      return {
        ...actual,
        upsertPilotApplication,
      };
    });

    const mod = await import('../route');
    const res = await mod.POST(new Request('http://localhost/api/pilot-intake', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Анна',
        telegramContact: '@pilot_owner',
        role: 'owner',
        city: 'Казань',
        propertyCount: '02',
        channelManager: 'none',
        platforms: ['sutochno'],
        hasActiveBookings: 'yes',
        testFocus: 'communications',
        feedbackReady: 'yes',
      }),
    }));

    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      ok: true,
      contactId: 'contact-1',
      telegramLink: expect.stringContaining('?start='),
      cabinetHref: '/connect?redirect=%2Fdashboard%2Fproperties%3FcrmContactId%3Dcontact-1',
    });
    expect(upsertPilotApplication).toHaveBeenCalledWith(expect.objectContaining({
      propertyCount: 2,
      crmRole: 'owner',
      telegramUsername: 'pilot_owner',
    }));
  });
});
