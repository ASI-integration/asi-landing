import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildAnalysis } from '../gravity-scoring';
import {
  fetchOsmDataForPaidReport,
  PAID_REPORT_DEGRADED_MAP_DATA_WARNING,
} from '../location-report-engine';

const mockFetchOsmData = vi.fn();

vi.mock('../overpass', () => ({
  fetchOsmData: (...args: unknown[]) => mockFetchOsmData(...args),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('fetchOsmDataForPaidReport', () => {
  it('uses the bounded fast-demo profile instead of the full Overpass pipeline', async () => {
    mockFetchOsmData.mockResolvedValue({
      elements: [{ type: 'node', id: 1, lat: 55.75, lon: 37.61, tags: { amenity: 'cafe' } }],
      hadProviderFailure: false,
    });

    const result = await fetchOsmDataForPaidReport(55.75, 37.61);

    expect(mockFetchOsmData).toHaveBeenCalledWith(
      55.75,
      37.61,
      expect.objectContaining({
        fastDemo: true,
        allowBroadFallback: false,
        requestTimeoutMs: 6_000,
      }),
    );
    expect(result.elements).toHaveLength(1);
  });

  it('returns an empty degraded result when the bounded fetch throws', async () => {
    mockFetchOsmData.mockRejectedValue(new Error('network_error'));

    const result = await fetchOsmDataForPaidReport(55.75, 37.61);

    expect(result).toMatchObject({
      elements: [],
      hadProviderFailure: true,
      usedFallbackQuery: true,
    });
  });
});

describe('paid report degraded map integrity', () => {
  it('keeps a deliverable location score when OSM data is missing', () => {
    const analysis = buildAnalysis([], 55.75, 37.61, { spatialFoundation: true });
    const scoreBefore = analysis.locationScore?.location_score ?? 0;
    expect(scoreBefore).toBeGreaterThan(0);

    analysis.analysisIntegrity = {
      analysisIncomplete: true,
      scoreBlockedDueToIncompleteData: false,
      reasons: [PAID_REPORT_DEGRADED_MAP_DATA_WARNING],
    };

    expect(analysis.locationScore?.location_score).toBe(scoreBefore);
    expect(analysis.analysisIntegrity?.scoreBlockedDueToIncompleteData).toBe(false);
  });
});
