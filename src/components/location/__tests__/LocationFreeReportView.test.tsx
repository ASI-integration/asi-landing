import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  LocationFreeReportView,
  normalizeFreeReportFactors,
} from '../LocationFreeReportView';
import type { GeneratedFreeLocationReportData } from '@/lib/location/location-report-engine';

const rawMedicalFactor =
  'Больница святого великомученика Георгия · Больницы и медкластеры · 530 м — Больница святого великомученика Георгия — около 530 м';

const baseReport: GeneratedFreeLocationReportData = {
  reportId: 'report-1',
  reportMode: 'free',
  inputAddress: 'Санкт-Петербург, Невский проспект, 88',
  calculatedAt: '2026-05-16T10:00:00.000Z',
  status: 'ready',
  score: 74,
  publicScore: 74,
  shortConclusion: 'Локация подходит как первый фильтр.',
  verdictSummary: 'Локация подходит как первый фильтр.',
  keyDemandDrivers: [],
  evidenceBullets: [
    rawMedicalFactor,
    rawMedicalFactor,
    'Станция метро Площадь Мужества · Метро и транспорт · 830 м — Станция метро Площадь Мужества — около 830 м',
    'Станция метро Лесная · Метро и транспорт · 940 м — Станция метро Лесная — около 940 м',
    'Городские сервисы · Городская инфраструктура · 310 м',
  ],
  mainRisks: ['Очень длинное техническое ограничение не должно попадать в публичный блок.'],
  risksAndLimitsRu: ['Очень длинное техническое ограничение не должно попадать в публичный блок.'],
  nearbyStrongObjects: [],
  recommendationRu: 'Держите чистоту и тишину в часы пик у клиник — это напрямую влияет на отзывы гостей.',
  pdfUrl: '/api/location-report/report-1/pdf',
  pdfStatus: 'ready',
};

describe('LocationFreeReportView', () => {
  it('shows clear PDF and detailed report actions', () => {
    const html = renderToStaticMarkup(<LocationFreeReportView report={baseReport} />);

    expect(html).toContain('Скачать отчёт PDF');
    expect(html).toContain('Получить подробный отчёт');
  });

  it('renders normalized free report factors without duplicated POI/category fragments', () => {
    const html = renderToStaticMarkup(<LocationFreeReportView report={baseReport} />);

    expect(html).toContain('Медицинские учреждения рядом: возможен спрос от пациентов, сопровождающих и командировочных.');
    expect(html).toContain('Метро в пешей доступности: объект проще продвигать для гостей без автомобиля.');
    expect(html).toContain('Ориентир по карте: около 830–940 м.');
    expect(html).not.toContain('Больница святого великомученика Георгия · Больницы и медкластеры');
    expect(html).not.toContain('Метро · Метро');
    expect(html).not.toMatch(/·[^<]*·[^<]*—[^<]*—/);
  });

  it('does not repeat the same POI name or category inside a normalized bullet', () => {
    const bullets = normalizeFreeReportFactors([rawMedicalFactor]);

    expect(bullets).toEqual([
      'Медицинские учреждения рядом: возможен спрос от пациентов, сопровождающих и командировочных. Ориентир по карте: около 530 м.',
    ]);
    expect(bullets[0]).not.toContain('Больница святого великомученика Георгия');
    expect(bullets[0]).not.toContain('Больницы и медкластеры');
  });

  it('does not render specific operational clinic advice in the free report', () => {
    const html = renderToStaticMarkup(<LocationFreeReportView report={baseReport} />);

    expect(html).not.toContain('Держите чистоту и тишину');
    expect(html).toContain(
      'Для решения по объекту проверьте экономику, конкурентов и сценарий запуска в подробном отчёте.',
    );
  });

  it('shows paid report preview and commercial potential preview', () => {
    const html = renderToStaticMarkup(<LocationFreeReportView report={baseReport} />);

    expect(html).toContain('Дополнительный потенциал');
    expect(html).toContain('Предварительный сигнал коммерческой активности');
    expect(html).toContain('Подробная конкуренция');
    expect(html).toContain('Расчёт доходности и цены');
    expect(html).toContain('Коммерческий и пешеходный потенциал');
  });
});
