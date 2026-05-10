import { afterEach, describe, expect, it, vi } from 'vitest';
import { EisOfficialConnector, clampNoticesDateRangeUtc } from '../data-sources/public-procurement/eis-official-client';
import {
  EIS_OFFICIAL_CONNECTOR_ENABLED_ENV_KEY,
  EIS_ORGANIZATION_INN_ENV_KEY,
  EIS_PMD_TOKEN_ENV_KEY,
  EIS_REQUEST_MODE_ENV_KEY,
  EIS_SERVICE_BASE_URL_ENV_KEY,
  resolveEisOfficialConnectorConfig,
} from '../data-sources/public-procurement/eis-official-config';
import {
  buildGetDocsByOrgRegionRequest,
  EIS_SOAP_PLACEHOLDER_NS,
  validateSoapEnvelopeStructure,
} from '../data-sources/public-procurement/eis-official-soap-builder';
import { runPublicProcurementIngestionPipeline } from '../data-sources/public-procurement/public-procurement-ingestion';

describe('EIS official connector skeleton', () => {
  const prev: Record<string, string | undefined> = {};

  afterEach(() => {
    vi.restoreAllMocks();
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    Object.keys(prev).forEach(k => delete prev[k]);
  });

  function stashEnv(key: string): void {
    if (!(key in prev)) prev[key] = process.env[key];
  }

  it('is disabled by default (no outbound HTTP; controlled disabled result)', () => {
    stashEnv(EIS_OFFICIAL_CONNECTOR_ENABLED_ENV_KEY);
    delete process.env[EIS_OFFICIAL_CONNECTOR_ENABLED_ENV_KEY];

    const connector = new EisOfficialConnector();
    expect(resolveEisOfficialConnectorConfig(process.env).connectorEnabled).toBe(false);
    expect(connector.searchNoticesByRegion({ regionCode: '77' })).toEqual({
      kind: 'disabled',
      outboundHttp: false,
      reason: 'env_flag_off',
    });
  });

  it('dry-run builds a SOAP/XML envelope and validates structure without network', () => {
    const connector = new EisOfficialConnector({
      env: {
        [EIS_OFFICIAL_CONNECTOR_ENABLED_ENV_KEY]: 'true',
        [EIS_REQUEST_MODE_ENV_KEY]: 'TEST',
      },
    });

    const result = connector.searchNoticesByRegion({ regionCode: '77', limit: 10 }, { dryRun: true });
    expect(result.kind).toBe('dry_run');
    if (result.kind !== 'dry_run') throw new Error('expected dry_run');
    expect(result.outboundHttp).toBe(false);
    expect(result.soapEnvelopeRedacted).toContain('<soapenv:Envelope');
    expect(result.soapEnvelopeRedacted).toContain('<soapenv:Body');
    expect(result.soapEnvelopeRedacted).toContain('<eis:GetDocsByOrgRegion>');
    expect(result.soapEnvelopeRedacted).toContain(EIS_SOAP_PLACEHOLDER_NS);
    expect(validateSoapEnvelopeStructure(result.soapEnvelopeRedacted)).toBe(true);
  });

  it('missing token yields safe config error (no secret echoed)', () => {
    const connector = new EisOfficialConnector({
      env: {
        [EIS_OFFICIAL_CONNECTOR_ENABLED_ENV_KEY]: 'true',
        [EIS_REQUEST_MODE_ENV_KEY]: 'TEST',
        [EIS_SERVICE_BASE_URL_ENV_KEY]: 'https://example.invalid/eis',
        [EIS_ORGANIZATION_INN_ENV_KEY]: '7707083893',
      },
    });

    const result = connector.getDocsByRegistryNumber({ registryNumber: 'RN-1' });
    expect(result.kind).toBe('config_error');
    if (result.kind !== 'config_error') throw new Error('expected config_error');
    expect(result.code).toBe('missing_pmd_token');
    expect(result.message).toContain('EIS_PMD_TOKEN');
  });

  it('token is never included in thrown soap-builder errors or returned dry-run payloads', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const secret = 'pmd-token-never-leak-9f3c2a1b';
    let caught = '';
    try {
      buildGetDocsByOrgRegionRequest({
        authToken: secret,
        requestMode: 'TEST',
        organizationInn: '7707083893',
        regionCode: '',
      });
    } catch (e) {
      caught = e instanceof Error ? e.message : String(e);
    }
    expect(caught).toContain('region code');
    expect(caught).not.toContain(secret);

    const connector = new EisOfficialConnector({
      env: {
        [EIS_OFFICIAL_CONNECTOR_ENABLED_ENV_KEY]: 'true',
        [EIS_REQUEST_MODE_ENV_KEY]: 'TEST',
        [EIS_PMD_TOKEN_ENV_KEY]: secret,
      },
    });

    const dry = connector.getDocsByRegistryNumber({ registryNumber: 'RN-DRY' }, { dryRun: true });
    expect(dry.kind).toBe('dry_run');
    if (dry.kind !== 'dry_run') throw new Error('expected dry_run');
    expect(dry.soapEnvelopeRedacted).not.toContain(secret);
    expect(dry.soapEnvelopeRedacted).toContain('[EIS_PMD_TOKEN_REDACTED]');

    expect(logSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('date range is clamped to a safe maximum window', () => {
    const from = new Date(Date.UTC(2026, 0, 1));
    const to = new Date(Date.UTC(2026, 11, 31));
    const clamped = clampNoticesDateRangeUtc(from, to);
    expect(clamped.clamped).toBe(true);
    const spanDays = (clamped.dateTo.getTime() - clamped.dateFrom.getTime()) / (24 * 60 * 60 * 1000);
    expect(spanDays).toBeLessThanOrEqual(31 + 1e-9);
  });

  it('normalized ЕИС-shaped payloads flow through the existing procurement ingestion pipeline', () => {
    const connector = new EisOfficialConnector();

    const xml = `
<doc>
  <registryNumber>0324100004526000999</registryNumber>
  <docName>Тестовый объект для пайплайна</docName>
  <regionHint>Москва</regionHint>
  <publishedAt>2026-04-01</publishedAt>
</doc>`;

    const normalized = connector.normalizeEisDocument(xml);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) throw new Error(normalized.message);

    const pipeline = runPublicProcurementIngestionPipeline(normalized.workUnit, {
      locale: 'ru',
      sourceName: 'public-procurement.eisOfficial.skeleton',
      dataMode: 'live_probe_sample_cache',
    });

    expect(pipeline.signal.kind).toBe('publicProcurement');
    expect(pipeline.signal.title).toContain('Тестовый объект');
  });

  it('enabled connector without dry-run stays HTTP-off (live wiring not implemented)', () => {
    const connector = new EisOfficialConnector({
      env: {
        [EIS_OFFICIAL_CONNECTOR_ENABLED_ENV_KEY]: 'true',
        [EIS_REQUEST_MODE_ENV_KEY]: 'TEST',
        [EIS_PMD_TOKEN_ENV_KEY]: 'token',
        [EIS_SERVICE_BASE_URL_ENV_KEY]: 'https://example.invalid/eis',
        [EIS_ORGANIZATION_INN_ENV_KEY]: '7707083893',
      },
    });

    expect(connector.searchNoticesByRegion({ regionCode: '77' }).kind).toBe('live_http_not_wired');
  });
});
