import React from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LocationStandaloneFullReport } from '@/components/location/LocationStandaloneFullReport';
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

describe('standalone report without persisted metadata', () => {
  it('paid permalink payload without metadata renders without error', () => {
    const analysis = fixtureAnalysis();
    const report = buildLocationStandaloneReport({
      address: 'Москва, тест',
      analysis,
      verdict: 'Полный отчёт.',
      reportMode: 'paid',
    });
    report.metadata = undefined;

    let html = '';
    expect(() => {
      html = renderToString(React.createElement(LocationStandaloneFullReport, { report }));
    }).not.toThrow();

    expect(html).toContain('data-freshness');
    expect(html).toContain('Данные рассчитаны ранее, точное время расчёта недоступно');
  });
});
