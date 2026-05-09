import { describe, expect, it } from 'vitest';
import {
  isCanonicalLocationReportPayload,
  isLocationCommercialReport,
  isLocationStandaloneReportV1,
} from '../standalone-report';
import {
  LOCATION_REPORT_PRODUCT_PATH,
  LOCATION_REPORT_SAMPLE_PATH,
  buildLocationReportPermalink,
} from '../report-state';

describe('canonical location report guards', () => {
  it('rejects legacy hash-generated report-shaped values', () => {
    const legacyReportLikePayload = {
      id: 'moscow-tverskaya-1',
      address: 'Москва, Тверская 1',
      score: 84,
      demandStability: 'High',
      monthlyMin: 120000,
      monthlyMax: 180000,
      competitors500m: 14,
      generatedAt: new Date().toISOString(),
    };

    expect(isCanonicalLocationReportPayload(legacyReportLikePayload)).toBe(false);
    expect(isLocationStandaloneReportV1(legacyReportLikePayload)).toBe(false);
    expect(isLocationCommercialReport(legacyReportLikePayload)).toBe(false);
  });

  it('keeps product report CTAs on canonical report surfaces', () => {
    expect(LOCATION_REPORT_PRODUCT_PATH).toBe('/ru/otchet-po-dohodnosti-obektov');
    expect(LOCATION_REPORT_SAMPLE_PATH).toBe('/ru/location-report/sample');
    expect(buildLocationReportPermalink({ reportId: 'abc 123', locale: 'ru' }))
      .toBe('/ru/location-report/abc%20123');
  });
});
