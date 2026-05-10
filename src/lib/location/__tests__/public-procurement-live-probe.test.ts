import { afterEach, describe, expect, it } from 'vitest';
import { computeUrbanDevelopmentForecastScore } from '../data-sources/urban-development-forecast-score';
import { collectUrbanDevelopmentSignals } from '../data-sources/urban-development';
import {
  PUBLIC_PROCUREMENT_LIVE_PROBE_ADAPTER_OPTION_KEYS,
  createPublicProcurementLiveProbeAdapter,
  isPublicProcurementLiveProbeEnabled,
} from '../data-sources/public-procurement/public-procurement-live-probe-adapter';
import {
  PublicProcurementLiveClient,
  resolvePublicProcurementLiveProbeSourceAccessMode,
} from '../data-sources/public-procurement/public-procurement-live-client';

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
    expect(adapter.sourceAccessMode).toBe('verified_cache');
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
    expect(adapter.sourceAccessMode).toBe('disabled');
    const collected = await collectUrbanDevelopmentSignals({ regionOrCity: 'Москва', locale: 'ru' }, [adapter]);
    expect(collected.signals).toEqual([]);

    const client = new PublicProcurementLiveClient({ env: { [ENV_KEY]: '1' } });
    expect(client.isLiveProbeEnabled()).toBe(true);
    await expect(client.listNoticeWorkUnits('Москва')).resolves.toEqual([]);
  });

  it('live probe adapter constructor surface excludes credential-style option keys', () => {
    expect(PUBLIC_PROCUREMENT_LIVE_PROBE_ADAPTER_OPTION_KEYS).toEqual([
      'client',
      'enabled',
      'id',
      'label',
      'env',
      'sampleCacheFixture',
      'sourceAccessMode',
    ]);
  });

  it('resolvePublicProcurementLiveProbeSourceAccessMode defaults to verified_cache when probe is off', () => {
    expect(resolvePublicProcurementLiveProbeSourceAccessMode({ liveProbeEnabled: false })).toBe('verified_cache');
    expect(resolvePublicProcurementLiveProbeSourceAccessMode({ liveProbeEnabled: true })).toBe('disabled');
    expect(
      resolvePublicProcurementLiveProbeSourceAccessMode({ liveProbeEnabled: true, explicit: 'official_api' }),
    ).toBe('official_api');
  });

  it('live probe client ignores unrelated credential-like env keys and sample-cache stays usable', async () => {
    delete process.env[ENV_KEY];

    const noisyEnv = {
      [ENV_KEY]: '',
      EIS_PMD_TOKEN: 'must-not-appear-on-signals',
      USER_ZAKUPKI_PASSWORD: 'secret-password-placeholder',
    };

    const client = new PublicProcurementLiveClient({ env: noisyEnv });
    expect(client.isLiveProbeEnabled()).toBe(false);

    const units = await client.listNoticeWorkUnits('Москва');
    expect(units.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(units);
    expect(serialized).not.toContain('must-not-appear-on-signals');
    expect(serialized).not.toContain('secret-password-placeholder');
  });
});
