import { describe, expect, it } from 'vitest';
import type { OSMElement } from '../types';
import { buildAnalysis } from '../gravity-scoring';
import {
  buildCommercialReport,
  buildLocationStandaloneReport,
  isCanonicalLocationReportPayload,
} from '../standalone-report';
import {
  buildExpressLocationReport,
  buildFullLocationReport,
  locationReportInputFromLegacy,
} from '../unified-report';

function fixtureAnalysis() {
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
    {
      type: 'node',
      id: 3,
      lat: 55.7505,
      lon: 37.616,
      tags: { name: 'Test Grand Hotel', tourism: 'hotel' },
    },
    {
      type: 'node',
      id: 4,
      lat: 55.754,
      lon: 37.62,
      tags: { name: 'Test Competitor Hotel', tourism: 'hotel' },
    },
    {
      type: 'node',
      id: 5,
      lat: 55.753,
      lon: 37.619,
      tags: { name: 'Тестовая достопримечательность', tourism: 'attraction' },
    },
  ];

  return buildAnalysis(elements, subject.lat, subject.lon, { spatialFoundation: true });
}

describe('unified location potential report', () => {
  it('builds an express report with essential blocks', () => {
    const report = buildExpressLocationReport(
      locationReportInputFromLegacy({
        address: 'Москва, тестовая локация',
        locale: 'ru',
        mode: 'residential',
      }),
      { analysis: fixtureAnalysis() },
    );

    expect(report.version).toBe('unified-location-potential-report-v1');
    expect(report.level).toBe('express');
    expect(report.sections.map(s => s.id)).toEqual([
      'summary',
      'demand',
      'competition',
      'pricing',
      'magnets',
      'risks',
      'recommendation',
    ]);
    expect(report.signals.demand.status).toBe('available');
    expect(report.signals.competition.competitorCount).toBeGreaterThanOrEqual(0);
  });

  it('builds a full report with missing urban development represented honestly', () => {
    const report = buildFullLocationReport(
      locationReportInputFromLegacy({
        address: 'Москва, тестовая локация',
        locale: 'ru',
        mode: 'residential',
      }),
      { analysis: fixtureAnalysis() },
    );

    const urban = report.signals.urbanDevelopment;
    expect(report.level).toBe('full');
    expect(report.sections.some(s => s.id === 'urban_development')).toBe(true);
    expect(urban.status).toBe('not_configured');
    expect(urban.sourceStatus).toBe('not_configured');
    expect(urban.manualVerificationNeeded).toBe(true);
    expect(urban.evidence).toEqual([]);
    expect(urban.limitations.join(' ')).toContain(
      'Данные о планируемом развитии района не подключены',
    );
    expect(JSON.stringify(urban)).not.toContain('Через 5 лет');
  });

  it('maps residential legacy input into unified guest-stay signals', () => {
    const input = locationReportInputFromLegacy({
      address: 'Москва, тестовая локация',
      locale: 'ru',
      mode: 'residential',
    });
    const report = buildFullLocationReport(input, { analysis: fixtureAnalysis() });

    expect(report.input.goal).toBe('rent');
    expect(report.input.useCase).toBe('guest_stay');
    expect(report.signals.audienceFit.residentialStrategy).toBeDefined();
    expect(report.signals.demand.shortTermRentalPotential).not.toBeNull();
  });

  it('maps commercial-style input into unified format and transport signals', () => {
    const input = locationReportInputFromLegacy({
      address: 'Москва, тестовая коммерческая точка',
      locale: 'ru',
      mode: 'commercial',
    });
    const report = buildFullLocationReport(input, { analysis: fixtureAnalysis() });

    expect(report.input.goal).toBe('launch');
    expect(report.input.useCase).toBe('retail_or_service');
    expect(report.signals.audienceFit.formatFit).toBeDefined();
    expect(report.signals.transportInfrastructure.status).toBe('available');
  });

  it('keeps canonical compatibility wrappers backed by the unified core', () => {
    const analysis = fixtureAnalysis();
    const residential = buildLocationStandaloneReport({
      address: 'Москва, тестовая локация',
      analysis,
      verdict: 'ok',
    });
    const commercial = buildCommercialReport({
      address: 'Москва, тестовая коммерческая точка',
      analysis,
    });

    expect(isCanonicalLocationReportPayload(residential)).toBe(true);
    expect(isCanonicalLocationReportPayload(commercial)).toBe(true);
    expect(residential.unifiedReport?.version).toBe('unified-location-potential-report-v1');
    expect(commercial.unifiedReport?.signals.audienceFit.formatFit).toBeDefined();
  });
});
