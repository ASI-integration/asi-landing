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
import {
  getPublicPaidReportFeatureInventory,
  paidLocationReportStructureSections,
} from '@/lib/location/location-report-structure';

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
    expect(html).not.toContain('предпросмотр');
  });

  it('does not expose paid report data, internal summaries, or PDF download', () => {
    const html = renderToStaticMarkup(
      <LocationReportPublicPreview report={report} reportId="report-1" />,
    );
    const inventory = getPublicPaidReportFeatureInventory();

    expect(html).not.toContain('Скачать PDF');
    expect(html).not.toContain('/api/location-report/report-1/pdf');
    expect(html).not.toContain('premium-revenue-scenarios');
    expect(html).not.toContain('premium-future-development');
    expect(html).not.toContain('Для владельца:');
    expect(html).not.toContain('Бесплатный');
    expect(html).not.toContain('бесплатн');
    expect(html).not.toContain('₽');
    expect(html).not.toContain('/ мес');
    expect(html).not.toContain('premium-');
    expect(html).not.toContain('H3-гексы');
    expect(html).not.toContain('Медицинские и образовательные якоря');
    expect(html).not.toContain('Госзакупки и ранние признаки развития территории');
    expect(html).not.toContain('Итоговое решение: брать / не брать / проверять глубже');
    expect(html).toContain('Медицина и образование рядом');
    expect(html).toContain('Госзакупки и ранние сигналы роста');
    expect(html).toContain('Итоговое решение по объекту');
    expect(html).toContain('Показывает, может ли территория стать сильнее');
    expect(html).not.toContain('Новые дома, кварталы и стройки, которые могут изменить');
    expect(html).not.toContain('Командировки, подрядчики, деловые поездки');
    expect(inventory.every(item => item.descriptionRu.startsWith('Показывает'))).toBe(true);
  });

  it('shows a premium example slide gallery instead of repeated locked placeholders', () => {
    const html = renderToStaticMarkup(<LocationReportPublicPreview report={report} />);

    expect(html).toContain('Общий вывод по объекту');
    expect(html).toContain('Спрос и целевая аудитория');
    expect(html).toContain('Конкуренция рядом');
    expect(html).toContain('Будущее района');
    expect(html).toContain('Ниже — примеры страниц полного отчёта.');
    expect(html).toContain('Блоки для жилья и аренды отделены от коммерции и street-retail.');
    expect(html).toContain('ASI смотрит не только на то, что есть рядом сейчас, но и на горизонт развития до 10 лет');
    expect(html).toContain('госзакупки');
    expect(html).toContain('Доходность и сценарии');
    expect(html).toContain('Показывает, подходит ли адрес для аренды, проживания или покупки.');
    expect(html).toContain('целевой поток для бизнеса');
    expect(html).toContain('Подходит для коммерции и ритейла');
    expect(html).toContain('Показывает, подходит ли адрес для аренды, проживания или покупки.');
    expect(html).not.toContain('blur-[6px]');
    expect(html).not.toContain('Доступно в полном отчёте');
    expect(html).not.toContain('Подробный разбор по этому блоку доступен в полном отчёте.');
    expect(html).not.toContain('предпросмотр');
    expect(html).toContain('Потенциал:');
    expect(html).toContain('75–85%');
    expect(html).not.toContain('7.8');
  });

  it('renders the full public paid value inventory from the canonical paid report sections', () => {
    const html = renderToStaticMarkup(<LocationReportPublicPreview report={report} />);
    const inventory = getPublicPaidReportFeatureInventory();
    const canonicalPaidDetailIds = paidLocationReportStructureSections
      .filter(section => section.disclosure === 'paid_detail')
      .map(section => section.id);

    expect(html).toContain('Что входит в полный отчёт');
    expect(html).toContain('В полной версии не 2–3 общих вывода');
    expect(html).toContain('горизонте до 10 лет');
    expect(html).toContain('Вы видите не весь расчёт, а карту того, что будет внутри.');
    expect(html).toContain('Недвижимость и аренда');
    expect(html).toContain('Коммерция и ритейл');
    expect(html).toContain('Будущее района до 10 лет');
    expect(html.match(/data-public-paid-feature-card="true"/g) ?? []).toHaveLength(inventory.length);
    expect(inventory.map(item => item.id)).toEqual(canonicalPaidDetailIds);
    expect(inventory).toHaveLength(34);
    expect(html).toContain('Деловой и командировочный спрос');
    expect(html).toContain('Доходность: базовый сценарий');
    expect(html).toContain('Будущее района');
    expect(html).toContain('Первая линия и вход');
    expect(html).toContain('Итоговое решение по объекту');
    expect(html).not.toMatch(/preview/i);
    expect(html).not.toContain('предпросмотр');
    expect(html.match(/Детальный расчёт появится после оплаты/g) ?? []).toHaveLength(0);
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
