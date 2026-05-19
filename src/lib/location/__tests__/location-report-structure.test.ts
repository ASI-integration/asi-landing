import { describe, expect, it } from 'vitest';
import {
  FREE_PAID_REPORT_TEASER_RU,
  buildLocationReportStructureViewModel,
  getLocationReportScopeSectionIds,
} from '../location-report-structure';

describe('location report structure', () => {
  it('defines the canonical free report format', () => {
    const structure = buildLocationReportStructureViewModel('free');

    expect(structure.titleRu).toBe('Отчёт по локации');
    expect(structure.sections.map(section => section.id)).toEqual([
      'shortAddressConclusion',
      'publicLocationStatus',
      'topResultReasons',
      'keyMagnetsPreview',
      'generalRecommendation',
      'orderDetailedReportCta',
    ]);
    expect(structure.cta.primaryLabel).toBe('Получить полный отчёт');
    expect(FREE_PAID_REPORT_TEASER_RU).toContain('коммерческий потенциал');
  });

  it('defines the canonical paid report format', () => {
    const structure = buildLocationReportStructureViewModel('paid');

    expect(structure.titleRu).toBe('Отчёт по локации');
    expect(structure.sections.map(section => section.titleRu)).toEqual([
      'Краткий вывод для владельца',
      'Кому подойдёт объект',
      'Главные магниты спроса',
      'Конкуренция',
      'Сценарии дохода',
      'Как может измениться район',
      'Риски',
      'Как запускать',
      'Итоговая рекомендация',
      'Транспортная доступность',
      'Среда вокруг объекта',
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
