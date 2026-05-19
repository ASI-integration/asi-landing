import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  LOCATION_REPORT_PUBLIC_PREVIEW_CTA_LABEL,
  LocationReportPublicPreview,
} from '../LocationReportPublicPreview';
import { buildLocationStandaloneReport } from '@/lib/location/standalone-report';
import { buildAnalysis } from '@/lib/location/gravity-scoring';

describe('LocationReportPublicPreview', () => {
  const analysis = buildAnalysis([], 55.75, 37.61, { spatialFoundation: true });
  const report = buildLocationStandaloneReport({
    address: 'Москва, тестовый адрес',
    analysis,
    verdict: 'Локация подходит как первый фильтр.',
    reportMode: 'free',
  });

  it('shows address, calculation date framing, verdict, one strength, one risk, and full-report CTA', () => {
    const html = renderToStaticMarkup(
      <LocationReportPublicPreview report={report} reportId="report-1" />,
    );

    expect(html).toContain('Москва, тестовый адрес');
    expect(html).toContain('Дата и время расчёта');
    expect(html).toContain('Локация подходит как первый фильтр.');
    expect(html).toContain('Сильная сторона');
    expect(html).toContain('Главный риск');
    expect(html).toContain('Оплата будет подключена после финальной проверки отчёта. Сейчас доступна ссылка на сформированный отчёт.');
    expect(html).toContain(LOCATION_REPORT_PUBLIC_PREVIEW_CTA_LABEL);
    expect(html).not.toMatch(/preview/i);
    expect(html).not.toMatch(/превью/i);
  });

  it('does not expose paid-only sections or PDF download', () => {
    const html = renderToStaticMarkup(
      <LocationReportPublicPreview report={report} reportId="report-1" />,
    );

    expect(html).not.toContain('Скачать PDF');
    expect(html).not.toContain('/api/location-report/report-1/pdf');
    expect(html).not.toContain('premium-revenue-scenarios');
    expect(html).not.toContain('premium-future-development');
    expect(html).not.toContain('Осторожный');
    expect(html).not.toContain('Строящиеся ЖК');
    expect(html).not.toContain('Для владельца:');
    expect(html).not.toContain('Бесплатный');
    expect(html).not.toContain('бесплатн');
  });

  it('shows a premium example slide gallery instead of repeated locked placeholders', () => {
    const html = renderToStaticMarkup(<LocationReportPublicPreview report={report} />);

    expect(html).toContain('Общий вывод по объекту');
    expect(html).toContain('Спрос и целевая аудитория');
    expect(html).toContain('Конкуренция рядом');
    expect(html).toContain('Будущее района');
    expect(html).toContain('Доходность и сценарии');
    expect(html).not.toContain('blur-[6px]');
    expect(html).not.toContain('Доступно в полном отчёте');
    expect(html).not.toContain('Подробный разбор по этому блоку доступен в полном отчёте.');
  });
});
