import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocationAnalysis } from '../types';
import { buildReportArtifactUrls } from '../report-artifact';
import { createPaidReportProducers } from '../report-producers';
import { processPaidReportRequest } from '../paid-report-orchestration';
import { REPORT_ARTIFACT_STATUS } from '../report-artifact';
import { createPaidReportCalculationAdapterRegistry } from '../report-signal-adapters';
import type { ReportSnapshotRepository } from '../report-snapshot-repository';

const mockEnsurePaidLocationReportForRequest = vi.fn();
const mockGetLocationReportRequestById = vi.fn();
const mockMarkLocationReportRequestProcessing = vi.fn();
const mockMarkLocationReportRequestCompleted = vi.fn();
const mockMarkLocationReportRequestFailed = vi.fn();

vi.mock('../location-report-engine', () => ({
  ensurePaidLocationReportForRequest: (...args: unknown[]) =>
    mockEnsurePaidLocationReportForRequest(...args),
}));

vi.mock('../report-request-store', () => ({
  getLocationReportRequestById: (...args: unknown[]) => mockGetLocationReportRequestById(...args),
  markLocationReportRequestProcessing: (...args: unknown[]) =>
    mockMarkLocationReportRequestProcessing(...args),
  markLocationReportRequestCompleted: (...args: unknown[]) =>
    mockMarkLocationReportRequestCompleted(...args),
  markLocationReportRequestFailed: (...args: unknown[]) =>
    mockMarkLocationReportRequestFailed(...args),
}));

vi.mock('../report-pipeline-readiness-resolver', () => ({
  checkReportPipelineReadiness: vi.fn(async () => ({
    ready: true,
    checked_at: '2026-05-20T10:00:00.000Z',
    blockers: [],
    warnings: [],
    checks: [],
    metadata: { env: {} },
  })),
}));

function sampleAnalysis(): LocationAnalysis {
  return {
    evergreenIndex: 72,
    scoreBand: 'strong',
    locationScore: {
      location_score: 78,
      rating: 'strong',
      breakdown: {
        demand_score: 80,
        magnet_score: 82,
        seasonality_score: 65,
        accessibility_score: 75,
        environment_score: 68,
      },
      estimated_monthly_income: { short_term: 120000, mid_term: 90000, hybrid: 105000 },
      income_model: { base_adr_rub: 4500, base_occupancy_pct: 62 },
      top_positive_factors: ['Метро рядом'],
      top_negative_factors: [],
      recommended_strategy: 'short_term',
    },
    magnets: [],
    magnetCountByCategory: {},
    accessibilityStops: [{ name: 'Метро Тестовая', distance: 420 }],
    competitors: [],
    gravityExplanation: {
      competitorPressureLevel: 'medium',
      explanationRu: 'test',
    },
    demandType: 'mixed',
    strongestMagnets: [{ name: 'Парк', distance: 300, categoryId: 'park', anchorType: 'poi' } as any],
    clusterZones: [],
    splitDemand: false,
    competitorPressure: 0.3,
    footTraffic: { level: 'medium', score: 50, summaryRu: 'test' } as any,
    audienceAnalysis: { primaryAudience: 'FAMILY', confidence: 'medium' } as any,
    neighborhoodEnvironment: { environmentalFrictionScore: 20 } as any,
  } as unknown as LocationAnalysis;
}

const calculationContext = {
  requestId: 'request-1',
  reportId: 'report-paid-1',
  address: 'Москва, Тверская 1',
  lat: 55.75,
  lon: 37.61,
  verdict: 'Сильная локация для краткосрочной аренды.',
  recommendation: 'short_term',
  score: 78,
  magnets: [{ id: 'magnet_1', label: 'Парк', value: 'Парк (300 м)' }],
  transport: [{ id: 'transport_1', label: 'Метро Тестовая', value: 'Метро Тестовая (420 м)' }],
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('paid report real calculation wiring', () => {
  it('uses calculation-backed adapters with address-specific signals', async () => {
    const registry = createPaidReportCalculationAdapterRegistry(calculationContext);
    const producer = createPaidReportProducers({
      reportId: 'report-paid-1',
      adapterRegistry: registry,
    });

    const preliminary = await producer.preliminary.generate('request-1');
    const baseAdapter = preliminary.metadata?.adapter_summary?.adapters.find(
      item => item.id === 'base_location',
    );

    expect(preliminary.preliminary_report_url).toBe(
      '/ru/location-report/report-paid-1?view=preliminary',
    );
    expect(preliminary.pdf_url).toBeUndefined();
    expect(baseAdapter?.signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'address', value: calculationContext.address }),
        expect.objectContaining({ id: 'coordinates', value: { lat: 55.75, lon: 37.61 } }),
        expect.objectContaining({ id: 'score', value: 78 }),
      ]),
    );
    expect(baseAdapter?.source_meta).toMatchObject({ source: 'location_calculation' });
  });

  it('does not point paid pdf_url to the sample moderation route', async () => {
    const producer = createPaidReportProducers({ reportId: 'report-paid-1' });
    const pdf = await producer.pdf.generate('request-1');

    expect(pdf.pdf_url).toBe('/api/location-report/report-paid-1/pdf');
    expect(pdf.pdf_url).not.toContain('/ru/location-report/sample/pdf');
  });

  it('buildStaticPaidReportArtifactUrls now resolves real report routes', () => {
    expect(buildReportArtifactUrls('report-paid-1')).toEqual({
      preliminary_report_url: '/ru/location-report/report-paid-1?view=preliminary',
      final_report_url: '/ru/location-report/report-paid-1',
      pdf_url: '/api/location-report/report-paid-1/pdf',
    });
  });

  it('does not unlock report access for cancelled payment', async () => {
    mockGetLocationReportRequestById.mockResolvedValue({
      id: 'request-cancelled',
      access_tier: 'paid_required',
      payment_status: 'cancelled',
      status: 'queued',
      report_id: null,
    });

    await expect(processPaidReportRequest('request-cancelled')).rejects.toThrow('paid_unlock_required');
    expect(mockEnsurePaidLocationReportForRequest).not.toHaveBeenCalled();
  });

  it('requires paid_unlocked before orchestration runs calculation', async () => {
    mockGetLocationReportRequestById.mockResolvedValue({
      id: 'request-locked',
      access_tier: 'paid_required',
      payment_status: 'pending_payment',
      status: 'queued',
      report_id: null,
    });

    await expect(processPaidReportRequest('request-locked')).rejects.toThrow('paid_unlock_required');
    expect(mockEnsurePaidLocationReportForRequest).not.toHaveBeenCalled();
  });

  it('orchestrates producers after calculation and stores real artifact urls', async () => {
    const artifactStore = new Map<string, any>();
    mockGetLocationReportRequestById.mockResolvedValue({
      id: 'request-1',
      access_tier: 'paid_required',
      payment_status: 'paid_unlocked',
      status: 'queued',
      report_id: null,
    });
    mockEnsurePaidLocationReportForRequest.mockResolvedValue({
      reportId: 'report-paid-1',
      analysis: sampleAnalysis(),
      context: calculationContext,
    });

    const artifact = await processPaidReportRequest('request-1', {
      artifactRepository: {
        async getByRequestId(requestId) {
          return artifactStore.get(requestId) ?? null;
        },
        async upsert(requestId, patch) {
          const current = artifactStore.get(requestId) ?? {
            request_id: requestId,
            status: REPORT_ARTIFACT_STATUS.reportForming,
            preliminary_report_url: null,
            final_report_url: null,
            pdf_url: null,
            generated_at: null,
            expires_at: null,
            cleanup_ready: false,
            metadata: {},
            created_at: '2026-05-20T10:00:00.000Z',
            updated_at: '2026-05-20T10:00:00.000Z',
          };
          const next = { ...current, ...patch, updated_at: '2026-05-20T10:01:00.000Z' };
          artifactStore.set(requestId, next);
          return next;
        },
      },
      snapshotRepository: {
        async createSnapshot(input: Parameters<ReportSnapshotRepository['createSnapshot']>[0]) {
          return {
            ...input,
            snapshot_id: 'snap-1',
            version: 1,
            created_at: '2026-05-20T10:00:00.000Z',
          };
        },
        async getLatestSnapshot() {
          return null;
        },
        async listSnapshots() {
          return [];
        },
      } as ReportSnapshotRepository,
      deliveryRepository: { async createDeliveries() { return []; } } as any,
      entitlementRepository: { async createEntitlements() { return []; } } as any,
      auditRepository: { async createAuditEvent() { return {} as any; } } as any,
    });

    expect(mockEnsurePaidLocationReportForRequest).toHaveBeenCalledWith('request-1');
    expect(artifact.status).toBe(REPORT_ARTIFACT_STATUS.pdfReady);
    expect(artifact.pdf_url).toBe('/api/location-report/report-paid-1/pdf');
    expect(artifact.final_report_url).toBe('/ru/location-report/report-paid-1');
    expect(mockMarkLocationReportRequestCompleted).toHaveBeenCalledWith({
      requestId: 'request-1',
      reportId: 'report-paid-1',
    });
  });
});
