import { describe, expect, it } from 'vitest';
import {
  canExposePaidLocationReport,
  locationReportAccessStatusForPersistence,
} from '../report-access';
import type { LocationStandaloneReport } from '../standalone-report';

const basePaid: LocationStandaloneReport = {
  version: 'v1',
  reportMode: 'paid',
  address: 'Москва, Тверская 1',
  generated_at_iso: '2026-05-16T10:00:00.000Z',
  sections: [{ id: 'summary', verdict: 'ok', drivers: [], income_rub_month: null, recommended_strategy: null }],
};

describe('report-access', () => {
  it('unlocks legacy paid rows without explicit accessStatus', () => {
    const legacy = { ...basePaid, reportMode: undefined as unknown as 'paid' };
    delete (legacy as { accessStatus?: string }).accessStatus;

    expect(locationReportAccessStatusForPersistence(legacy)).toBe('paid_unlocked');
    expect(canExposePaidLocationReport(legacy)).toBe(true);
  });

  it('keeps pending_payment rows locked', () => {
    const locked = { ...basePaid, accessStatus: 'pending_payment' as const };
    expect(canExposePaidLocationReport(locked)).toBe(false);
  });

  it('never exposes free preview rows as paid', () => {
    const free = { ...basePaid, reportMode: 'free' as const };
    expect(canExposePaidLocationReport(free)).toBe(false);
  });
});
