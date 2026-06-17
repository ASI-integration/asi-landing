import { describe, expect, it } from 'vitest';
import {
  buildPilotApplicationTelegramLink,
  buildPilotCabinetConnectHref,
  buildPilotPropertiesRedirect,
  buildPilotTelegramContinuation,
  buildPilotTelegramStartPayload,
  computeDashboardPilotProgress,
  computePilotOnboardingProgress,
  isPilotConnectRedirect,
  parsePilotTelegramStartPayload,
  shouldShowDashboardPilotBlock,
} from '../pilot-onboarding';

const CONTACT_ID = '6c9f99b1-726c-4fcf-d428-bcb23d84df20';

describe('pilot onboarding helpers', () => {
  it('builds telegram and cabinet links for a pilot application', () => {
    expect(buildPilotTelegramStartPayload(CONTACT_ID)).toBe(`pilot_${CONTACT_ID}`);
    expect(parsePilotTelegramStartPayload(`pilot_${CONTACT_ID}`)).toBe(CONTACT_ID);
    expect(buildPilotApplicationTelegramLink(CONTACT_ID)).toContain('?start=');
    expect(buildPilotApplicationTelegramLink(CONTACT_ID)).toContain(encodeURIComponent(`pilot_${CONTACT_ID}`));
    expect(buildPilotPropertiesRedirect(CONTACT_ID)).toBe(`/dashboard/properties?crmContactId=${CONTACT_ID}`);
    expect(buildPilotCabinetConnectHref(CONTACT_ID)).toBe(
      `/connect?redirect=${encodeURIComponent(`/dashboard/properties?crmContactId=${CONTACT_ID}`)}`,
    );
  });

  it('detects pilot connect redirects', () => {
    expect(isPilotConnectRedirect('/dashboard/properties')).toBe(true);
    expect(isPilotConnectRedirect('/dashboard/properties?crmContactId=abc')).toBe(true);
    expect(isPilotConnectRedirect('/dashboard')).toBe(false);
  });

  it('builds telegram fallback when pilot contact id is missing', () => {
    const fallback = buildPilotTelegramContinuation(null);
    expect(fallback.href).toMatch(/^https:\/\/t\.me\//);
    expect(fallback.hint).toBe('Напишите /start и выберите роль владельца');
  });

  it('shows dashboard pilot block when crm contact id is known', () => {
    expect(shouldShowDashboardPilotBlock(CONTACT_ID)).toBe(true);
    expect(shouldShowDashboardPilotBlock(null)).toBe(false);

    const progress = computeDashboardPilotProgress({
      crmContactId: CONTACT_ID,
      properties: [{ id: 'prop-1', city: null, address: null }],
    });
    expect(progress?.currentStepId).toBe('object_filled');
  });

  it('computes onboarding progress for a submitted pilot application', () => {
    const progress = computePilotOnboardingProgress({
      source: 'pilot_form',
      status: 'pilot_candidate',
      propertyId: null,
      pilotApplication: {
        city: 'Казань',
        propertyCount: 2,
        channelManager: 'Нет',
        platforms: ['Авито'],
        hasActiveBookings: 'Да',
        testFocus: 'Коммуникации',
        feedbackReady: 'Да',
        roleAnswer: 'Владелец',
        telegramContact: '@owner',
        suggestedNextAction: 'Выбрать в пилот и предложить создать объект',
        submittedAt: '2026-06-17T10:00:00.000Z',
      },
      propertySummary: null,
      recentEvents: [
        {
          id: 'e1',
          eventType: 'pilot_application_submitted',
          messageText: null,
          propertyId: null,
          metadata: {},
          acknowledgedAt: null,
          createdAt: '2026-06-17T10:00:00.000Z',
          label: 'Заявка в пилот',
        },
      ],
    });

    expect(progress?.currentStepId).toBe('pilot_selected');
    expect(progress?.steps[0]?.done).toBe(true);
    expect(progress?.steps[1]?.done).toBe(false);
  });
});
