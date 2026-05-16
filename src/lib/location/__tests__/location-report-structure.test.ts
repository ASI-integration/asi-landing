import { describe, expect, it } from 'vitest';
import {
  FREE_PAID_REPORT_TEASER_RU,
  buildLocationReportStructureViewModel,
  getLocationReportScopeSectionIds,
} from '../location-report-structure';

describe('location report structure', () => {
  it('defines the canonical free report format', () => {
    const structure = buildLocationReportStructureViewModel('free');

    expect(structure.titleRu).toBe('Бесплатный общий отчёт');
    expect(structure.sections.map(section => section.id)).toEqual([
      'shortAddressConclusion',
      'publicLocationStatus',
      'topResultReasons',
      'keyMagnetsPreview',
      'generalRecommendation',
      'orderDetailedReportCta',
    ]);
    expect(structure.cta.primaryLabel).toBe('Получить подробный отчёт');
    expect(FREE_PAID_REPORT_TEASER_RU).toContain('коммерческий потенциал');
  });

  it('defines the canonical paid report format', () => {
    const structure = buildLocationReportStructureViewModel('paid');

    expect(structure.titleRu).toBe('Подробный отчёт');
    expect(structure.sections.map(section => section.titleRu)).toEqual([
      'Полный вывод по адресу',
      'Подробные магниты',
      'Аудитория спроса',
      'Конкуренция',
      'Транспортная доступность',
      'Среда вокруг объекта',
      'Риски и ограничения',
      'Рекомендации по упаковке, цене и каналам продаж',
      'Следующий шаг',
    ]);
    expect(structure.cta).toMatchObject({
      primaryLabel: 'Подключить управление',
      secondaryLabel: 'Обсудить объект',
    });
  });

  it('derives scope sections from the canonical structure', () => {
    expect(getLocationReportScopeSectionIds('free')).toEqual([
      'addressAndCalculatedAt',
      'shortVerdict',
      'publicScore',
      'topEvidenceBullets',
      'shortRecommendation',
      'paidReportTeaser',
      'CTA',
    ]);

    expect(getLocationReportScopeSectionIds('paid')).toContain('nextStepCTA');
  });
});
