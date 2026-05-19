import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  LOCATION_REPORT_PUBLIC_PREVIEW_CTA_LABEL,
  LocationReportPublicPreview,
} from '../LocationReportPublicPreview';
import { buildLocationStandaloneReport } from '@/lib/location/standalone-report';
import { buildAnalysis } from '@/lib/location/gravity-scoring';
import { isYooKassaEnabled } from '@/lib/payments/yookassa-env';

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
    expect(html.match(/Оплата будет подключена/g) ?? []).toHaveLength(1);
    expect(html).toContain(LOCATION_REPORT_PUBLIC_PREVIEW_CTA_LABEL);
    expect(html).not.toContain('Детальный расчёт появится после оплаты.');
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
    expect(html).not.toContain('Медицинские и образовательные якоря');
    expect(html).not.toContain('Госзакупки и ранние признаки развития территории');
    expect(html).not.toContain('Итоговое решение: брать / не брать / проверять глубже');
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
    expect(html).toContain('Ниже показаны примеры страниц полного отчёта.');
    expect(html).toContain('В полной версии больше разделов: экономика, конкуренция, транспорт, якоря спроса, развитие района и горизонт до 10 лет.');
    expect(html).toContain('ASI смотрит не только на то, что есть рядом сейчас, но и на горизонт развития до 10 лет');
    expect(html).toContain('госзакупки');
    expect(html).toContain('Доходность и сценарии');
    expect(html).toContain('Показывает, стоит ли рассматривать объект');
    expect(html).toContain('Показывает, кто может здесь бронировать');
    expect(html).toContain('Показывает, насколько рядом плотная конкуренция');
    expect(html).toContain('Показывает, что приводит гостей к адресу');
    expect(html).toContain('Показывает, как меняется экономика в разных сценариях');
    expect(html).toContain('Показывает, что проверить до решения');
    expect(html).toContain('Показывает, как район может измениться');
    expect(html).not.toContain('blur-[6px]');
    expect(html).not.toContain('Доступно в полном отчёте');
    expect(html).not.toContain('Подробный разбор по этому блоку доступен в полном отчёте.');
    expect(html).not.toContain('предпросмотр');
    expect(html).toContain('Потенциал:');
    expect(html).toContain('75–85%');
    expect(html).not.toContain('7.8');
  });

  it('keeps YooKassa disabled during public report review', () => {
    const previous = process.env.YOOKASSA_ENABLED;
    delete process.env.YOOKASSA_ENABLED;

    try {
      expect(isYooKassaEnabled()).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env.YOOKASSA_ENABLED;
      } else {
        process.env.YOOKASSA_ENABLED = previous;
      }
    }
  });
});
