import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocationStandaloneReport } from '../standalone-report';

const mocks = vi.hoisted(() => ({
  cacheGetByAddress: vi.fn(),
  cacheSet: vi.fn(),
  geocodePlainAddressForMarket: vi.fn(),
  fetchOsmData: vi.fn(),
  buildAnalysis: vi.fn(),
  applyLocationDataIntegrityGate: vi.fn(),
  buildLocationStandaloneReport: vi.fn(),
  createStandaloneReport: vi.fn(),
  getStandaloneReportById: vi.fn(),
}));

vi.mock('../cache', () => ({
  cacheGetByAddress: (...args: unknown[]) => mocks.cacheGetByAddress(...args),
  cacheSet: (...args: unknown[]) => mocks.cacheSet(...args),
}));

vi.mock('../address-providers/geocode-pipeline', () => ({
  geocodePlainAddressForMarket: (...args: unknown[]) => mocks.geocodePlainAddressForMarket(...args),
}));

vi.mock('../overpass', () => ({
  fetchOsmData: (...args: unknown[]) => mocks.fetchOsmData(...args),
}));

vi.mock('../gravity-scoring', () => ({
  buildAnalysis: (...args: unknown[]) => mocks.buildAnalysis(...args),
}));

vi.mock('../location-data-integrity', () => ({
  applyLocationDataIntegrityGate: (...args: unknown[]) => mocks.applyLocationDataIntegrityGate(...args),
}));

vi.mock('../standalone-report', async () => {
  const actual = await vi.importActual<typeof import('../standalone-report')>('../standalone-report');
  return {
    ...actual,
    buildLocationStandaloneReport: (...args: unknown[]) => mocks.buildLocationStandaloneReport(...args),
  };
});

vi.mock('../standalone-report-store', () => ({
  createStandaloneReport: (...args: unknown[]) => mocks.createStandaloneReport(...args),
  getStandaloneReportById: (...args: unknown[]) => mocks.getStandaloneReportById(...args),
}));

const baseReport: LocationStandaloneReport = {
  version: 'v1',
  reportMode: 'free',
  inputAddress: 'Санкт-Петербург, Невский проспект, 88',
  normalizedAddress: 'санкт-петербург, невский проспект, 88',
  calculatedAt: '2026-05-16T10:00:00.000Z',
  status: 'ready',
  pdfStatus: 'ready',
  metadata: {
    calculatedAt: '2026-05-16T10:00:00.000Z',
    inputAddress: 'Санкт-Петербург, Невский проспект, 88',
    normalizedAddress: 'санкт-петербург, невский проспект, 88',
    reportMode: 'free',
    dataFreshness: {
      currentLocationAsOfIso: '2026-05-16T10:00:00.000Z',
      summaryRu: 'Данные сохранены на момент расчёта.',
    },
    sourceStatus: {
      current_location: 'live',
      urban_development: 'cache_or_not_connected',
      procurement: 'official_api_disabled',
    },
    clientFreshnessRu: {
      usedSources: ['Картографический слой.'],
      preparingSources: ['Градостроительные сигналы подключены частично.'],
    },
  },
  dataFreshness: {
    currentLocationAsOfIso: '2026-05-16T10:00:00.000Z',
    summaryRu: 'Данные сохранены на момент расчёта.',
  },
  address: 'Санкт-Петербург, Невский проспект, 88',
  generated_at_iso: '2026-05-16T10:00:00.000Z',
  freeSummary: {
    conclusionRu: 'Локация подходит как первый фильтр.',
    publicScore: 74,
    keyFactorsRu: ['Метро рядом · Транспорт · 420 м', 'Сервисы рядом · Локальный спрос · 300 м'],
    risksAndLimitsRu: ['Проверить конкурентов вручную'],
    recommendationRu: 'Используйте краткий вывод как первый фильтр.',
  },
  sections: [
    {
      id: 'summary',
      verdict: 'Локация подходит как первый фильтр.',
      drivers: ['Метро рядом · Транспорт · 420 м'],
      income_rub_month: null,
      recommended_strategy: null,
    },
    { id: 'next_step', cta: 'get_full_breakdown' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cacheGetByAddress.mockResolvedValue(null);
  mocks.cacheSet.mockResolvedValue(undefined);
  mocks.geocodePlainAddressForMarket.mockResolvedValue({ result: { lat: 59.93, lon: 30.36 } });
  mocks.fetchOsmData.mockResolvedValue({
    elements: [{ type: 'node', id: 1, lat: 59.93, lon: 30.36, tags: { amenity: 'cafe', name: 'Кафе' } }],
    hadProviderFailure: false,
    usedFallbackQuery: false,
  });
  mocks.buildAnalysis.mockReturnValue({
    locationScore: { location_score: 74 },
    conclusion: 'Локация подходит как первый фильтр.',
    analysisIntegrity: {},
  });
  mocks.buildLocationStandaloneReport.mockReturnValue(baseReport);
  mocks.createStandaloneReport.mockImplementation(async ({ report }: { report: LocationStandaloneReport }) => {
    const reportId = '44444444-4444-4444-8444-444444444444';
    const savedReport = {
      ...report,
      reportId,
      pdfUrl: `/api/location-report/${reportId}/pdf`,
      pdfStatus: 'ready',
      status: 'ready',
    };
    mocks.getStandaloneReportById.mockResolvedValue({
      id: reportId,
      locale: 'ru',
      address: savedReport.address,
      report_version: savedReport.version,
      report: savedReport,
      created_at: '2026-05-16T10:00:00.000Z',
    });
    return { reportId };
  });
});

describe('generateFreeLocationReport', () => {
  it('creates, saves, loads, and returns a public-safe free report', async () => {
    const { generateFreeLocationReport } = await import('../location-report-engine');

    const result = await generateFreeLocationReport('Санкт-Петербург, Невский проспект, 88');

    expect(result.reportId).toBe('44444444-4444-4444-8444-444444444444');
    expect(result.permalink).toBe('/ru/location-report/44444444-4444-4444-8444-444444444444');
    expect(result.report).toMatchObject({
      reportId: '44444444-4444-4444-8444-444444444444',
      reportMode: 'free',
      inputAddress: 'Санкт-Петербург, Невский проспект, 88',
      publicScore: 74,
      shortConclusion: 'Локация подходит как первый фильтр.',
      keyDemandDrivers: ['Метро рядом · Транспорт · 420 м', 'Сервисы рядом · Локальный спрос · 300 м'],
      mainRisks: ['Проверить конкурентов вручную'],
      nearbyStrongObjects: [
        { summaryRu: 'Метро рядом · Транспорт · 420 м' },
        { summaryRu: 'Сервисы рядом · Локальный спрос · 300 м' },
      ],
    });
    expect(mocks.createStandaloneReport).toHaveBeenCalledWith(expect.objectContaining({
      locale: 'ru',
      report: expect.objectContaining({ reportMode: 'free' }),
    }));
    expect(mocks.getStandaloneReportById).toHaveBeenCalledWith('44444444-4444-4444-8444-444444444444');
    expect(result.report).not.toHaveProperty('paidSections');
    expect(result.report).not.toHaveProperty('unifiedReport');
    expect(result.report).not.toHaveProperty('strReport');
    expect(JSON.stringify(result.report)).not.toContain('income_rub_month');
    expect(JSON.stringify(result.report)).not.toContain('competitorDetails');
  });
});
