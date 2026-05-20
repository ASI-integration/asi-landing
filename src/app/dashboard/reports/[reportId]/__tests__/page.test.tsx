import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LocationStandaloneReport } from '@/lib/location/standalone-report';

const mockGetStandaloneReportById = vi.fn();

vi.mock('@/lib/location/standalone-report-store', () => ({
  getStandaloneReportById: (...args: unknown[]) => mockGetStandaloneReportById(...args),
}));

vi.mock('@/components/location/LocationStandaloneFullReport', () => ({
  LocationStandaloneFullReport: ({ reportId }: { reportId?: string }) => <div>FULL {reportId}</div>,
}));

vi.mock('@/components/location/CommercialReportView', () => ({
  CommercialReportView: () => <div>COMMERCIAL FULL</div>,
}));

vi.mock('../ReportPlaceholderClient', () => ({
  ReportPlaceholderClient: ({ reportId }: { reportId: string }) => <div>PENDING {reportId}</div>,
}));

const paidReport: LocationStandaloneReport = {
  version: 'v1',
  reportMode: 'paid',
  accessStatus: 'paid_unlocked',
  address: 'Санкт-Петербург, Невский проспект, 88',
  generated_at_iso: '2026-05-16T10:00:00.000Z',
  sections: [
    {
      id: 'summary',
      verdict: 'Полный отчёт готов.',
      drivers: ['Метро рядом'],
      income_rub_month: 150000,
      recommended_strategy: 'short_term',
    },
    { id: 'next_step', cta: 'get_full_breakdown' },
  ],
};

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe('/dashboard/reports/[reportId] paid access', () => {
  it('loads a saved unlocked paid report by permalink', async () => {
    mockGetStandaloneReportById.mockResolvedValue({
      id: 'paid-1',
      locale: 'ru',
      address: paidReport.address,
      report_version: paidReport.version,
      report: paidReport,
      created_at: '2026-05-16T10:00:00.000Z',
    });
    const { default: Page } = await import('../page');

    const element = await Page({ params: Promise.resolve({ reportId: 'paid-1' }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('FULL paid-1');
    expect(html).not.toContain('PENDING paid-1');
  });

  it('does not unlock full report content from dashboard/localStorage-only state', async () => {
    mockGetStandaloneReportById.mockResolvedValue({
      id: 'paid-locked',
      locale: 'ru',
      address: paidReport.address,
      report_version: paidReport.version,
      report: { ...paidReport, accessStatus: 'pending_payment' },
      created_at: '2026-05-16T10:00:00.000Z',
    });
    const { default: Page } = await import('../page');

    const element = await Page({ params: Promise.resolve({ reportId: 'paid-locked' }) });
    const html = renderToStaticMarkup(element);

    expect(html).toContain('PENDING paid-locked');
    expect(html).not.toContain('FULL paid-locked');
  });
});
