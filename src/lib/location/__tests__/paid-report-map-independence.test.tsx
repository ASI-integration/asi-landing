import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAnalysis } from '../gravity-scoring';
import {
  fetchOsmDataForPaidReport,
  mapPaidReportProviderWarningsRu,
  PAID_REPORT_DEGRADED_MAP_DATA_WARNING,
  PAID_REPORT_GEOCODE_UNAVAILABLE_WARNING,
  PAID_REPORT_MAP_UNAVAILABLE_WARNING_RU,
  resolvePaidReportCoordinates,
} from '../location-report-engine';
import { buildLocationStandaloneReport } from '../standalone-report';
import { createPaidReportCalculationAdapterRegistry } from '../report-signal-adapters';
import { buildReportSections } from '../report-sections';
import { collectReportSignalsForLayers } from '../report-signal-adapters';
import type { LocationReportRequestEntity } from '../report-request-store';
import { buildPremiumPdfViewModel } from '../premium-pdf-view-model';
import { buildGeneratedLocationReportDocument } from '../location-report-engine';
import { PremiumLocationReportPdf } from '@/components/location/premium-pdf/PremiumLocationReportPdf';
import { LocationStandaloneFullReport } from '@/components/location/LocationStandaloneFullReport';

const mockGeocodePlainAddressForPaidReport = vi.fn();

vi.mock('../address-providers/geocode-pipeline', () => ({
  geocodePlainAddressForMarket: (...args: unknown[]) => mockGeocodePlainAddressForPaidReport(...args),
}));

vi.mock('../overpass', () => ({
  fetchOsmData: vi.fn(async () => ({
    elements: [],
    hadProviderFailure: true,
    usedFallbackQuery: true,
  })),
}));

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.YANDEX_MAPS_API_KEY;
  delete process.env.NEXT_PUBLIC_YANDEX_MAPS_API_KEY;
});

function paidRequest(overrides: Partial<LocationReportRequestEntity> = {}): LocationReportRequestEntity {
  return {
    id: 'request-geo',
    locale: 'ru',
    address: 'Санкт-Петербург, Невский проспект, 88',
    mode: 'residential',
    status: 'queued',
    payment_status: 'paid_unlocked',
    access_tier: 'paid_required',
    lat: null,
    lon: null,
    report_id: null,
    ...overrides,
  } as LocationReportRequestEntity;
}

describe('paid report map independence', () => {
  it('resolves coordinates via OSM geocode fallback without Yandex env', async () => {
    mockGeocodePlainAddressForPaidReport.mockResolvedValue({
      result: { lat: 59.93, lon: 30.33, displayName: 'Санкт-Петербург' },
      winner: 'nominatim',
      attempts: [],
    });

    const resolved = await resolvePaidReportCoordinates(paidRequest());

    expect(resolved).toMatchObject({
      lat: 59.93,
      lon: 30.33,
      mapDisplay: 'available',
      providerWarnings: [],
    });
  });

  it('does not block when geocode fails but RU city center fallback is available', async () => {
    mockGeocodePlainAddressForPaidReport.mockResolvedValue({
      result: null,
      winner: null,
      attempts: [],
    });

    const resolved = await resolvePaidReportCoordinates(paidRequest());

    expect(resolved.mapDisplay).toBe('unavailable');
    expect(resolved.providerWarnings).toContain(PAID_REPORT_GEOCODE_UNAVAILABLE_WARNING);
    expect(Number.isFinite(resolved.lat)).toBe(true);
    expect(Number.isFinite(resolved.lon)).toBe(true);
  });

  it('maps degraded map/geocode warnings to public RU copy', () => {
    expect(
      mapPaidReportProviderWarningsRu([PAID_REPORT_DEGRADED_MAP_DATA_WARNING], 'available'),
    ).toEqual([PAID_REPORT_MAP_UNAVAILABLE_WARNING_RU]);
    expect(
      mapPaidReportProviderWarningsRu([], 'unavailable'),
    ).toEqual([PAID_REPORT_MAP_UNAVAILABLE_WARNING_RU]);
  });

  it('persists provider warnings on snapshot sections when map data is degraded', async () => {
    const analysis = buildAnalysis([], 55.75, 37.61, { spatialFoundation: true });
    analysis.analysisIntegrity = {
      analysisIncomplete: true,
      scoreBlockedDueToIncompleteData: false,
      reasons: [PAID_REPORT_DEGRADED_MAP_DATA_WARNING],
    };
    const report = buildLocationStandaloneReport({
      address: 'Москва, Тестовая 1',
      analysis,
      verdict: 'Тест',
      reportMode: 'paid',
      coordinates: { lat: 55.75, lon: 37.61 },
      mapDisplay: 'unavailable',
      providerWarningsRu: [PAID_REPORT_MAP_UNAVAILABLE_WARNING_RU],
    });
    const registry = createPaidReportCalculationAdapterRegistry({
      requestId: 'request-1',
      reportId: 'report-1',
      address: report.address,
      lat: 55.75,
      lon: 37.61,
      verdict: 'Тест',
      recommendation: 'short_term',
      score: 70,
      magnets: [],
      transport: [],
      providerWarnings: [PAID_REPORT_DEGRADED_MAP_DATA_WARNING],
      mapDisplayAvailable: false,
    });
    const adapterSummary = await collectReportSignalsForLayers({
      request: { requestId: 'request-1', stage: 'final' },
      layers: ['fast'],
      registry,
    });
    const sections = buildReportSections(adapterSummary);
    const locationSection = sections.find(section => section.id === 'location');

    expect(locationSection?.warnings.length).toBeGreaterThan(0);
    expect(locationSection?.status).toBe('warning');
  });

  it('renders paid report UI without map SDK and shows map-unavailable notice', () => {
    const analysis = buildAnalysis([], 55.75, 37.61, { spatialFoundation: true });
    const report = buildLocationStandaloneReport({
      address: 'Москва, Тестовая 1',
      analysis,
      verdict: 'Тестовый вывод',
      reportMode: 'paid',
      coordinates: { lat: 55.75, lon: 37.61 },
      mapDisplay: 'unavailable',
      providerWarningsRu: [PAID_REPORT_MAP_UNAVAILABLE_WARNING_RU],
    });

    const html = renderToStaticMarkup(
      <LocationStandaloneFullReport report={report} reportId="report-map" />,
    );

    expect(html).toContain(PAID_REPORT_MAP_UNAVAILABLE_WARNING_RU);
    expect(html).toContain('55.75000');
    expect(html).not.toContain('api-maps.yandex');
    expect(html).not.toContain('mapgl.2gis.com');
  });

  it('builds premium PDF view model without external map dependency', () => {
    const analysis = buildAnalysis([], 55.75, 37.61, { spatialFoundation: true });
    const persisted = buildLocationStandaloneReport({
      address: 'Москва, Тестовая 1',
      analysis,
      verdict: 'Тест',
      reportMode: 'paid',
      coordinates: { lat: 55.75, lon: 37.61 },
      mapDisplay: 'unavailable',
      providerWarningsRu: [PAID_REPORT_MAP_UNAVAILABLE_WARNING_RU],
    });
    const doc = buildGeneratedLocationReportDocument({
      id: 'report-pdf',
      locale: 'ru',
      address: persisted.address,
      report_version: 'v1',
      report: persisted,
      created_at: '2026-05-20T10:00:00.000Z',
    });
    const model = buildPremiumPdfViewModel(doc);
    const html = renderToStaticMarkup(<PremiumLocationReportPdf model={model} />);

    expect(model.location.mapUnavailableNotice?.value).toBe(PAID_REPORT_MAP_UNAVAILABLE_WARNING_RU);
    expect(html).toContain(PAID_REPORT_MAP_UNAVAILABLE_WARNING_RU);
    expect(html).not.toContain('api-maps.yandex');
  });

  it('fetchOsmDataForPaidReport does not require commercial map API keys', async () => {
    const result = await fetchOsmDataForPaidReport(55.75, 37.61);
    expect(result.hadProviderFailure).toBe(true);
    expect(result.elements).toEqual([]);
  });
});
