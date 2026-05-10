import { describe, expect, it } from 'vitest';
import type { OSMElement } from '../types';
import { buildAnalysis } from '../gravity-scoring';
import {
  buildLocationReportResultMetadata,
  clientFreshnessPlainTextRu,
  resolveProcurementSourceDisclosureStatus,
} from '../report-result-metadata';
import { buildLocationStandaloneReport } from '../standalone-report';

function fixtureAnalysis(): ReturnType<typeof buildAnalysis> {
  const subject = { lat: 55.751, lon: 37.618 };
  const elements: OSMElement[] = [
    {
      type: 'relation',
      id: 1,
      center: { lat: 55.755, lon: 37.616 },
      tags: { name: 'Метро Охотный Ряд', station: 'subway', railway: 'station' },
    },
    {
      type: 'node',
      id: 2,
      lat: 55.752,
      lon: 37.621,
      tags: { name: 'Business Center Test', office: 'company' },
    },
  ];
  return buildAnalysis(elements, subject.lat, subject.lon, { spatialFoundation: true });
}

describe('location report result metadata', () => {
  it('free standalone report includes calculatedAt and reportMode free', () => {
    const analysis = fixtureAnalysis();
    const report = buildLocationStandaloneReport({
      address: 'Москва, ул. Тверская, 1',
      inputAddress: '  Москва, ул. Тверская, 1  ',
      analysis,
      verdict: 'Кратко.',
      reportMode: 'free',
      metadataEnv: {},
    });
    expect(report.metadata?.reportMode).toBe('free');
    expect(typeof report.metadata?.calculatedAt).toBe('string');
    expect(report.metadata?.calculatedAt.length).toBeGreaterThan(10);
    expect(report.metadata?.inputAddress).toBe('Москва, ул. Тверская, 1');
    expect(report.metadata?.normalizedAddress).toBe('москва, ул. тверская, 1');
  });

  it('paid standalone report includes calculatedAt and reportMode paid', () => {
    const analysis = fixtureAnalysis();
    const report = buildLocationStandaloneReport({
      address: 'Москва, тест',
      analysis,
      verdict: 'Полный отчёт.',
      reportMode: 'paid',
      metadataEnv: {},
    });
    expect(report.metadata?.reportMode).toBe('paid');
    expect(typeof report.metadata?.calculatedAt).toBe('string');
    expect(report.unifiedReport?.overallScore).not.toBeNull();
  });

  it('metadata attachment does not change overallScore vs baseline paid report', () => {
    const analysis = fixtureAnalysis();
    const withMeta = buildLocationStandaloneReport({
      address: 'Москва, тест',
      analysis,
      verdict: 'Полный отчёт.',
      reportMode: 'paid',
      metadataEnv: {},
    });
    const baselineScore = withMeta.unifiedReport?.overallScore ?? null;
    expect(withMeta.metadata).toBeDefined();
    expect(withMeta.unifiedReport?.overallScore).toBe(baselineScore);

    const second = buildLocationStandaloneReport({
      address: 'Москва, тест',
      analysis,
      verdict: 'Полный отчёт.',
      reportMode: 'paid',
      metadataEnv: { PUBLIC_PROCUREMENT_LIVE_PROBE_ENABLED: 'true' },
    });
    expect(second.unifiedReport?.overallScore).toBe(baselineScore);
    expect(second.metadata?.sourceStatus.procurement).toBe('probe_disabled');
  });

  it('when ЕИС official connector is disabled, procurement shows official_api_disabled', () => {
    expect(resolveProcurementSourceDisclosureStatus({})).toBe('official_api_disabled');
    expect(resolveProcurementSourceDisclosureStatus({ EIS_OFFICIAL_CONNECTOR_ENABLED: 'false' })).toBe(
      'official_api_disabled',
    );
    const meta = buildLocationReportResultMetadata({
      inputAddress: 'Test',
      reportMode: 'free',
      calculatedAtIso: '2026-05-10T12:00:00.000Z',
      env: {},
    });
    expect(meta.sourceStatus.procurement).toBe('official_api_disabled');
  });

  it('client freshness copy avoids fixture/sample identifiers and internal weight notation', () => {
    const meta = buildLocationReportResultMetadata({
      inputAddress: 'Москва',
      reportMode: 'paid',
      calculatedAtIso: '2026-05-10T12:00:00.000Z',
      env: {},
    });
    const blob = clientFreshnessPlainTextRu(meta);
    const lower = blob.toLowerCase();
    expect(lower).not.toContain('fixture');
    expect(lower).not.toContain('sample-location-report');
    expect(lower).not.toContain('sample-cache');
    expect(lower).not.toContain('live_probe_sample');
    expect(blob).not.toMatch(/\b\d{1,3}%/);
  });
});
