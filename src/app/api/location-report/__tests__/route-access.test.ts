import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGeocode = vi.fn();
const mockCacheGetByAddress = vi.fn();
const mockCacheSet = vi.fn();
const mockFetchOsmData = vi.fn();
const mockBuildAnalysis = vi.fn();
const mockGetRequest = vi.fn();
const mockCreateRequest = vi.fn();
const mockMarkProcessing = vi.fn();
const mockMarkCompleted = vi.fn();
const mockMarkFailed = vi.fn();
const mockCreateStandaloneReport = vi.fn();

vi.mock('@/lib/location/address-providers/geocode-pipeline', () => ({
  geocodePlainAddressForMarket: (...args: unknown[]) => mockGeocode(...args),
}));

vi.mock('@/lib/location/cache', () => ({
  normalizeAddress: (value: string) => value,
  cacheGetByAddress: (...args: unknown[]) => mockCacheGetByAddress(...args),
  cacheSet: (...args: unknown[]) => mockCacheSet(...args),
}));

vi.mock('@/lib/location/report-request-store', () => ({
  createLocationReportRequest: (...args: unknown[]) => mockCreateRequest(...args),
  getLocationReportRequestById: (...args: unknown[]) => mockGetRequest(...args),
  hasPaidLocationReportAccess: (entity: { access_status?: string }) =>
    entity.access_status === 'paid' || entity.access_status === 'generated',
  markLocationReportRequestProcessing: (...args: unknown[]) => mockMarkProcessing(...args),
  markLocationReportRequestCompleted: (...args: unknown[]) => mockMarkCompleted(...args),
  markLocationReportRequestFailed: (...args: unknown[]) => mockMarkFailed(...args),
}));

vi.mock('@/lib/auth', () => ({
  isSessionSecretConfigured: () => false,
  getSession: vi.fn(),
}));

vi.mock('@/lib/accounts', () => ({
  resolveAccountIdForUser: vi.fn(),
}));

vi.mock('@/lib/location/standalone-report-store', () => ({
  createStandaloneReport: (...args: unknown[]) => mockCreateStandaloneReport(...args),
}));

vi.mock('@/lib/location/standalone-report', () => ({
  buildLocationStandaloneReport: vi.fn(() => ({ kind: 'residential_report' })),
  buildCommercialReport: vi.fn(() => ({ kind: 'commercial_report' })),
}));

vi.mock('@/lib/location', async () => {
  const actual = await vi.importActual<typeof import('@/lib/location')>('@/lib/location');
  return {
    ...actual,
    fetchOsmData: (...args: unknown[]) => mockFetchOsmData(...args),
    buildAnalysis: (...args: unknown[]) => mockBuildAnalysis(...args),
  };
});

import { POST } from '../route';
import { POST as createRequestPOST } from '../../location-full-report/request/route';
import { POST as processRequestPOST } from '../../location-full-report/process/route';

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/location-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const locationScore = {
  location_score: 81,
  rating: 'strong',
  breakdown: {
    demand_score: 80,
    supply_score: 70,
    magnet_score: 75,
    seasonality_score: 65,
    audience_fit_score: 72,
    accessibility_score: 78,
  },
  estimated_monthly_income: { short_term: 180000, mid_term: 120000, hybrid: 150000 },
  top_positive_factors: ['Рядом сильный спрос', 'Хорошая транспортная доступность'],
  top_negative_factors: ['Есть конкуренция'],
  recommended_strategy: 'hybrid',
};

describe('POST /api/location-report paid access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LOCATION_REPORT_PAYMENT_PROVIDER = 'manual';
    delete process.env.LOCATION_REPORT_PAYMENT_URL;
    delete process.env.PRODAMUS_PAYMENT_URL;
    mockCacheGetByAddress.mockResolvedValue(null);
    mockGetRequest.mockResolvedValue(null);
    mockCreateRequest.mockResolvedValue({ requestId: 'req_new' });
    mockGeocode.mockResolvedValue({ result: { lat: 55.75, lon: 37.61 } });
    mockFetchOsmData.mockResolvedValue({ elements: [], hadProviderFailure: false, usedFallbackQuery: false });
    mockBuildAnalysis.mockReturnValue({ locationScore });
    mockCacheSet.mockResolvedValue(undefined);
    mockMarkProcessing.mockResolvedValue(undefined);
    mockMarkCompleted.mockResolvedValue(undefined);
    mockMarkFailed.mockResolvedValue(undefined);
    mockCreateStandaloneReport.mockResolvedValue({ reportId: 'report_new' });
  });

  it('does not trust client is_paid for full output', async () => {
    const res = await POST(makeReq({ address: 'Москва', locale: 'ru', is_paid: true }) as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.report.is_preview).toBe(true);
    expect(json.report.locked_fields).toContain('full_income');
    expect(json.report.breakdown).toBeUndefined();
  });

  it('returns full output only when server request state is paid', async () => {
    mockGetRequest.mockResolvedValue({ access_status: 'paid' });

    const res = await POST(makeReq({ address: 'Москва', locale: 'ru', request_id: 'req_paid' }) as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.report.is_preview).toBe(false);
    expect(json.report.breakdown).toBeDefined();
  });

  it('stores provider-neutral product and payment metadata when creating a RU request', async () => {
    process.env.LOCATION_REPORT_PAYMENT_PROVIDER = 'prodamus';
    process.env.LOCATION_REPORT_PAYMENT_URL = 'https://pay.example/location-report';

    const res = await createRequestPOST(makeReq({ address: 'Москва', locale: 'ru' }) as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.access_status).toBe('pending_payment');
    expect(json.product_type).toBe('location_report_detail');
    expect(json.payment_provider).toBe('prodamus');
    expect(json.payment_url).toBe('https://pay.example/location-report');
    expect(mockCreateRequest).toHaveBeenCalledWith(expect.objectContaining({
      accessStatus: 'pending_payment',
      accessTier: 'paid_required',
      paymentProvider: 'prodamus',
      paymentUrl: 'https://pay.example/location-report',
      productType: 'location_report_detail',
    }));
  });

  it('does not generate a full report for an unpaid RU request', async () => {
    mockGetRequest.mockResolvedValue({
      id: 'req_unpaid',
      locale: 'ru',
      access_status: 'pending_payment',
      payment_provider: 'manual',
      product_type: 'location_report_detail',
      status: 'queued',
    });

    const res = await processRequestPOST(makeReq({ requestId: 'req_unpaid' }) as any);
    const json = await res.json();

    expect(res.status).toBe(402);
    expect(json.error).toBe('payment_required');
    expect(json.access_status).toBe('pending_payment');
    expect(mockMarkProcessing).not.toHaveBeenCalled();
    expect(mockCreateStandaloneReport).not.toHaveBeenCalled();
  });

  it('generates a full report for a paid RU request', async () => {
    mockGetRequest.mockResolvedValue({
      id: 'req_paid',
      locale: 'ru',
      mode: 'residential',
      address: 'Москва',
      lat: 55.75,
      lon: 37.61,
      access_status: 'paid',
      payment_provider: 'manual',
      product_type: 'location_report_detail',
      status: 'queued',
      report_id: null,
    });

    const res = await processRequestPOST(makeReq({ requestId: 'req_paid' }) as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe('completed');
    expect(json.access_status).toBe('generated');
    expect(json.reportId).toBe('report_new');
    expect(mockMarkProcessing).toHaveBeenCalledWith('req_paid');
    expect(mockMarkCompleted).toHaveBeenCalledWith({ requestId: 'req_paid', reportId: 'report_new' });
  });
});
