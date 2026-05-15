import React from 'react';
import { readFileSync } from 'fs';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { LocationStandaloneFullReport } from '@/components/location/LocationStandaloneFullReport';
import { buildAnalysis } from '../gravity-scoring';
import {
  buildLocationStandaloneReport,
  sampleStrLocationStandaloneReportRu,
} from '../standalone-report';

describe('RU STR location report flow', () => {
  it('free preview is locked and does not include paid STR projection', () => {
    const analysis = buildAnalysis([], 55.75, 37.61, { spatialFoundation: true });
    const report = buildLocationStandaloneReport({
      address: 'Москва, тестовый адрес',
      analysis,
      verdict: 'Краткий предварительный вывод.',
      reportMode: 'free',
    });

    expect(report.reportMode).toBe('free');
    expect(report.strReport).toBeUndefined();
    expect(report.unifiedReport).toBeUndefined();
    expect(report.sections.map(section => section.id)).toEqual(['summary', 'next_step']);

    const html = renderToString(
      React.createElement(LocationStandaloneFullReport, {
        report,
      }),
    );

    expect(html).toContain('Бесплатный фрагмент по локации');
    expect(html).toContain('Подробный отчёт показывает, что относится к полной платной аналитике.');
    expect(html).toContain('Получить подробный отчёт');
    expect(html).not.toContain('Отчёт по посуточной аренде');
    expect(html).not.toContain('Вывод по посуточной аренде');
  });

  it('paid report includes required sellable STR sections', () => {
    const html = renderToString(
      React.createElement(LocationStandaloneFullReport, {
        report: sampleStrLocationStandaloneReportRu,
      }),
    );

    expect(html).toContain('Отчёт по посуточной аренде');
    expect(html).toContain('Вывод по посуточной аренде');
    expect(html).toContain('Кому подходит объект');
    expect(html).toContain('Сигналы спроса');
    expect(html).toContain('Территория и риски окружения');
    expect(html).toContain('Площадки бронирования и ручная проверка');
    expect(html).toContain('Риски и что проверить вручную');
  });

  it('no-evidence weak-zone output still produces a safe report structure', () => {
    const analysis = buildAnalysis([], 55.75, 37.61, { spatialFoundation: true });
    const report = buildLocationStandaloneReport({
      address: 'Москва, пустая зона',
      analysis,
      verdict: 'Полный отчёт.',
      reportMode: 'paid',
    });

    expect(report.strReport?.product).toBe('str-location-report');
    expect(report.strReport?.weakZoneRisk.summaryRu).toBe(
      'Недостаточно данных для уверенного вывода по окружению. Рекомендуем проверить транспорт, конкуренцию и фактический спрос вручную.',
    );
    expect(report.strReport?.risksAndManualChecksRu.length).toBeGreaterThan(0);
  });

  it('STR report code does not import residential purchase report logic', () => {
    const standaloneSource = readFileSync('src/lib/location/standalone-report.ts', 'utf8');
    const reportViewSource = readFileSync('src/components/location/LocationStandaloneFullReport.tsx', 'utf8');

    expect(standaloneSource).not.toContain("from './purchase");
    expect(standaloneSource).not.toContain("from '@/lib/location/purchase");
    expect(reportViewSource).not.toContain('/purchase');
  });
});
