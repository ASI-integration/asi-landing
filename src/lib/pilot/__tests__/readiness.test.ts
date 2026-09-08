import { describe, expect, it, vi } from 'vitest';
import { PilotAccessError } from '../errors';

vi.mock('server-only', () => ({}));

const getDevelopmentReadiness = vi.fn();

vi.mock('@/lib/development/readiness', () => ({
  getDevelopmentReadiness,
}));

describe('SP-08 getPilotReadiness', () => {
  it('maps canLaunch true to ready/canSubmit', async () => {
    getDevelopmentReadiness.mockResolvedValue({
      schemaVersion: 'asi.owner-console.readiness.v1',
      overallState: 'ready',
      canLaunch: true,
      checkedAt: '2026-09-08T12:00:00.000Z',
      runnerEvidence: null,
      components: {},
    });
    const { getPilotReadiness } = await import('../readiness');
    const view = await getPilotReadiness({ loadOwnerReadiness: getDevelopmentReadiness });
    expect(view).toEqual({
      state: 'ready',
      canSubmit: true,
      messageRu: 'Система готова к запуску задач пилота.',
      checkedAt: '2026-09-08T12:00:00.000Z',
    });
    expect(JSON.stringify(view)).not.toMatch(/runnerId|\/opt\/|SERVICE_ROLE|components/i);
  });

  it('maps canLaunch false to not_ready and blocks submit assert', async () => {
    getDevelopmentReadiness.mockResolvedValue({
      schemaVersion: 'asi.owner-console.readiness.v1',
      overallState: 'blocked',
      canLaunch: false,
      checkedAt: '2026-09-08T12:00:00.000Z',
      runnerEvidence: { identity: 'runner-host', checkedAt: 'x', expiresAt: 'y' },
      components: {
        bridge: { state: 'blocked', reasonCode: 'bridge_config_missing', message: 'secret', blockingLaunch: true },
      },
    });
    const { getPilotReadiness, assertPilotSubmissionReady } = await import('../readiness');
    const view = await getPilotReadiness({ loadOwnerReadiness: getDevelopmentReadiness });
    expect(view.state).toBe('not_ready');
    expect(view.canSubmit).toBe(false);
    expect(JSON.stringify(view)).not.toMatch(/runner-host|bridge_config_missing|secret|components/i);

    await expect(
      assertPilotSubmissionReady({ loadOwnerReadiness: getDevelopmentReadiness }),
    ).rejects.toMatchObject({
      code: 'readiness_blocked',
      status: 503,
    });
  });

  it('maps readiness lookup failure to error without fake success', async () => {
    getDevelopmentReadiness.mockRejectedValue(new Error('offline'));
    const { getPilotReadiness, assertPilotSubmissionReady } = await import('../readiness');
    const view = await getPilotReadiness({
      loadOwnerReadiness: getDevelopmentReadiness,
      now: () => new Date('2026-09-08T13:00:00.000Z'),
    });
    expect(view).toEqual({
      state: 'error',
      canSubmit: false,
      messageRu: 'Не удалось проверить готовность. Попробуйте позже.',
      checkedAt: '2026-09-08T13:00:00.000Z',
    });
    await expect(
      assertPilotSubmissionReady({ loadOwnerReadiness: getDevelopmentReadiness }),
    ).rejects.toBeInstanceOf(PilotAccessError);
    await expect(
      assertPilotSubmissionReady({ loadOwnerReadiness: getDevelopmentReadiness }),
    ).rejects.toMatchObject({ code: 'readiness_unavailable', status: 503 });
  });
});
