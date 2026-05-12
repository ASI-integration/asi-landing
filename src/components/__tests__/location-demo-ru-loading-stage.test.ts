import { describe, expect, it } from 'vitest';
import type { AnalysisMeta } from '@/lib/location/types';
import {
  metaHasPartialCartographicWarning,
  partialCartographicBannerMessage,
  ruDemoLoadingStageIndex,
  RU_DEMO_LOADING_STAGE_BOUNDARIES_MS,
} from '@/components/location-demo-ru-ux';

describe('RU demo loading stage index', () => {
  it('uses staged thresholds at 0–10s, 10–25s, 25s+', () => {
    expect(RU_DEMO_LOADING_STAGE_BOUNDARIES_MS).toEqual([10_000, 25_000]);
    expect(ruDemoLoadingStageIndex(-1)).toBe(0);
    expect(ruDemoLoadingStageIndex(0)).toBe(0);
    expect(ruDemoLoadingStageIndex(9_999)).toBe(0);
    expect(ruDemoLoadingStageIndex(10_000)).toBe(1);
    expect(ruDemoLoadingStageIndex(24_999)).toBe(1);
    expect(ruDemoLoadingStageIndex(25_000)).toBe(2);
    expect(ruDemoLoadingStageIndex(120_000)).toBe(2);
  });
});

describe('partial cartographic warnings helper', () => {
  it('detects partial_result / overpass_timeout / geocode_timeout', () => {
    expect(metaHasPartialCartographicWarning(null)).toBe(false);
    const mSparse: AnalysisMeta = {
      freshness: 'fresh',
      updatedAt: new Date().toISOString(),
      source: 'x',
      cached: false,
      warnings: [{ code: 'osm_sparse', message: 'sparse' }],
    };
    expect(metaHasPartialCartographicWarning(mSparse)).toBe(false);

    const mPartial: AnalysisMeta = {
      ...mSparse,
      warnings: [{ code: 'partial_result', message: '' }],
    };
    expect(metaHasPartialCartographicWarning(mPartial)).toBe(true);
    expect(partialCartographicBannerMessage(mPartial, 'fallback text')).toBe('fallback text');

    const mWorded: AnalysisMeta = {
      ...mSparse,
      warnings: [{ code: 'overpass_timeout', message: '  server msg  ' }],
    };
    expect(partialCartographicBannerMessage(mWorded, 'fallback')).toBe('server msg');
  });
});
