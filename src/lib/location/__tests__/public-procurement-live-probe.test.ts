import { afterEach, describe, expect, it } from 'vitest';
import { computeUrbanDevelopmentForecastScore } from '../data-sources/urban-development-forecast-score';
import { collectUrbanDevelopmentSignals } from '../data-sources/urban-development';
import {
  createPublicProcurementLiveProbeAdapter,
  isPublicProcurementLiveProbeEnabled,
} from '../data-sources/public-procurement/public-procurement-live-probe-adapter';
import { PublicProcurementLiveClient } from '../data-sources/public-procurement/public-procurement-live-client';

const ENV_KEY = 'PUBLIC_PROCUREMENT_LIVE_PROBE_ENABLED';

describe('public procurement live probe', () => {
  const prev = process.env[ENV_KEY];

  afterEach(() => {
    if (prev === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = prev;
  });

  it('isPublicProcurementLiveProbeEnabled is false by default and for common “off” spellings', () => {
    delete process.env[ENV_KEY];
    expect(isPublicProcurementLiveProbeEnabled(process.env)).toBe(false);
    expect(isPublicProcurementLiveProbeEnabled({})).toBe(false);

    expect(isPublicProcurementLiveProbeEnabled({ [ENV_KEY]: '' })).toBe(false);
    expect(isPublicProcurementLiveProbeEnabled({ [ENV_KEY]: '0' })).toBe(false);
    expect(isPublicProcurementLiveProbeEnabled({ [ENV_KEY]: 'false' })).toBe(false);
    expect(isPublicProcurementLiveProbeEnabled({ [ENV_KEY]: 'off' })).toBe(false);
  });

  it('isPublicProcurementLiveProbeEnabled is true only for explicit enabling tokens', () => {
    expect(isPublicProcurementLiveProbeEnabled({ [ENV_KEY]: '1' })).toBe(true);
    expect(isPublicProcurementLiveProbeEnabled({ [ENV_KEY]: 'true' })).toBe(true);
    expect(isPublicProcurementLiveProbeEnabled({ [ENV_KEY]: 'yes' })).toBe(true);
    expect(isPublicProcurementLiveProbeEnabled({ [ENV_KEY]: 'on' })).toBe(true);
  });

  it('sample-cache path returns normalized signals and a non-empty forecast score for Москва', async () => {
    delete process.env[ENV_KEY];

    const adapter = createPublicProcurementLiveProbeAdapter();
    const collected = await collectUrbanDevelopmentSignals({ regionOrCity: 'Москва', locale: 'ru' }, [adapter]);

    expect(collected.status).toBe('collected');
    expect(collected.signals.length).toBe(4);
    expect(collected.signals.every(s => s.kind === 'publicProcurement')).toBe(true);
    expect(collected.signals[0]?.limitations.some(l => l.includes('PUBLIC_PROCUREMENT_LIVE_PROBE_ENABLED'))).toBe(true);

    const forecast = computeUrbanDevelopmentForecastScore(collected.signals);
    expect(forecast.contributingSignals.length).toBeGreaterThan(0);
    expect(forecast.level).not.toBe('low');
  });

  it('when live probe flag is on, client does not read sample-cache (no outbound calls; empty list)', async () => {
    const adapter = createPublicProcurementLiveProbeAdapter({
      env: { [ENV_KEY]: 'true' },
    });
    const collected = await collectUrbanDevelopmentSignals({ regionOrCity: 'Москва', locale: 'ru' }, [adapter]);
    expect(collected.signals).toEqual([]);

    const client = new PublicProcurementLiveClient({ env: { [ENV_KEY]: '1' } });
    expect(client.isLiveProbeEnabled()).toBe(true);
    await expect(client.listNoticeWorkUnits('Москва')).resolves.toEqual([]);
  });
});
