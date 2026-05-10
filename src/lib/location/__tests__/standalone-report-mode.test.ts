import { describe, expect, it } from 'vitest';
import type { OSMElement } from '../types';
import { buildAnalysis } from '../gravity-scoring';
import { buildLocationStandaloneReport } from '../standalone-report';

function fixtureAnalysis(): ReturnType<typeof buildAnalysis> {
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
  ];
  return buildAnalysis(elements, subject.lat, subject.lon, { spatialFoundation: true });
}

describe('standalone residential reportMode (free vs paid)', () => {
  it('demo / free permalink builder uses reportMode free, free_brief, and omits unifiedReport', () => {
    const analysis = fixtureAnalysis();
    const report = buildLocationStandaloneReport({
      address: 'Москва, тест',
      analysis,
      verdict: 'Краткий вывод для демо.',
      reportMode: 'free',
    });

    expect(report.reportMode).toBe('free');
    expect(typeof report.free_brief).toBe('string');
    expect(report.free_brief!.length).toBeGreaterThan(10);
    expect(report.unifiedReport).toBeUndefined();

    const ids = report.sections.map(s => s.id);
    expect(ids).toEqual(['summary', 'next_step']);
    expect(report.sections.some(s => s.id === 'magnets')).toBe(false);
  });

  it('paid / full-report pipeline builder keeps reportMode paid, unifiedReport, and detailed sections', () => {
    const analysis = fixtureAnalysis();
    const report = buildLocationStandaloneReport({
      address: 'Москва, тест',
      analysis,
      verdict: 'Полный отчёт.',
      reportMode: 'paid',
    });

    expect(report.reportMode).toBe('paid');
    expect(report.free_brief).toBeUndefined();
    expect(report.unifiedReport?.version).toBe('unified-location-potential-report-v1');

    const ids = report.sections.map(s => s.id);
    expect(ids).toContain('magnets');
    expect(ids).toContain('business_fit');
    expect(ids).toContain('competition');
    expect(ids).toContain('income_strategy');

    const magnets = report.sections.find(s => s.id === 'magnets');
    expect(magnets && magnets.id === 'magnets').toBe(true);
  });

  it('defaults to paid when reportMode omitted (legacy callers)', () => {
    const analysis = fixtureAnalysis();
    const report = buildLocationStandaloneReport({
      address: 'Москва, тест',
      analysis,
      verdict: 'Полный отчёт.',
    });
    expect(report.unifiedReport?.version).toBe('unified-location-potential-report-v1');
    expect(report.sections.some(s => s.id === 'magnets')).toBe(true);
  });
});
