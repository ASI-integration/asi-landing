import React from 'react';
import { readFileSync } from 'fs';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { LocationReportPublicPreview } from '@/components/location/LocationReportPublicPreview';
import { LocationStandaloneFullReport } from '@/components/location/LocationStandaloneFullReport';
import { buildAnalysis } from '../gravity-scoring';
import {
  buildLocationStandaloneReport,
  sampleStrLocationStandaloneReportRu,
} from '../standalone-report';

describe('RU STR location report flow', () => {
  it('public preview is locked and does not include paid STR projection', () => {
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
    expect(report.reportStructure?.mode).toBe('free');
    expect(report.reportStructure?.cta.primaryLabel).toBe('Получить полный отчёт');
    expect(report.reportStructure?.sections.some(section => section.disclosure === 'cta')).toBe(true);
    expect(report.reportStructure?.paidPreviewSections?.some(section => section.id === 'revenueScenarios')).toBe(true);

    const html = renderToString(
      React.createElement(LocationReportPublicPreview, {
        report,
        reportId: 'preview-1',
      }),
    );

    expect(html).toContain('Отчёт по локации');
    expect(html).toContain('Получить полный отчёт');
    expect(html).not.toContain('Скачать PDF');
    expect(html).not.toContain('Отчёт по посуточной аренде');
    expect(html).not.toContain('Вывод по посуточной аренде');
    expect(html).not.toContain('premium-revenue-scenarios');
    expect(html).not.toContain('Осторожный');
    expect(html).not.toContain('Для владельца:');
  });

  it('paid report exposes exactly one PDF download action', () => {
    const html = renderToString(
      React.createElement(LocationStandaloneFullReport, {
        report: sampleStrLocationStandaloneReportRu,
        reportId: 'paid-report-1',
      }),
    );

    expect(html.match(/Скачать PDF/g)?.length).toBe(1);
    expect(html).toContain('href="/api/location-report/paid-report-1/pdf"');
    expect(html).toContain('download="location-report-paid-report-1.pdf"');
    expect(html).not.toContain('PDF-версия');
    expect(html).not.toContain('Печать / PDF');
  });

  it('paid report includes required sellable STR sections', () => {
    const html = renderToString(
      React.createElement(LocationStandaloneFullReport, {
        report: sampleStrLocationStandaloneReportRu,
      }),
    );

    expect(html).toContain('Отчёт по локации');
    expect(html).toContain('Итог');
    expect(html).toContain('Краткий вывод для владельца');
    expect(html).toContain('Кому подойдёт объект');
    expect(html).toContain('Главные магниты спроса');
    expect(html).toContain('Сценарии дохода');
    expect(html).toContain('Как может измениться район');
    expect(html).toContain('Строящиеся ЖК');
    expect(html).toContain('Итоговая рекомендация');
    expect(html).not.toContain('Доход / стратегия');
    expect(html).toContain('Следующий шаг');
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
