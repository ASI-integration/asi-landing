import { describe, expect, it } from 'vitest';
import {
  FREE_PAID_REPORT_TEASER_RU,
  PAID_REPORT_TEN_YEAR_HORIZON_RU,
  PUBLIC_PAID_REPORT_GALLERY_SECTION_IDS,
  buildLocationReportStructureViewModel,
  getLocationReportScopeSectionIds,
  paidLocationReportStructureSections,
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
    expect(FREE_PAID_REPORT_TEASER_RU).toContain('горизонт развития до 10 лет');
  });

  it('defines the expanded canonical paid report inventory', () => {
    const structure = buildLocationReportStructureViewModel('paid');

    expect(structure.titleRu).toBe('Отчёт по локации');
    expect(structure.sections.map(section => section.titleRu)).toEqual([
      'Общий вывод по объекту',
      'Кому подойдёт объект',
      'Деловой и командировочный спрос',
      'Туристический спрос',
      'Семейный спрос',
      'Среднесрочная аренда',
      'Транспортная доступность',
      'Аэропорты, вокзалы, порты и крупные узлы',
      'Магниты спроса рядом',
      'Медицинские и образовательные якоря',
      'Деловые и административные якоря',
      'Промышленные и логистические якоря',
      'Конкуренция рядом',
      'Карта конкурентов',
      'Насыщенность рынка',
      'Доходность: осторожный сценарий',
      'Доходность: базовый сценарий',
      'Доходность: сильный сценарий',
      'Риски объекта',
      'Рекомендации по запуску',
      'Позиционирование объявления',
      'Что улучшить в объекте',
      'Будущее района',
      'Стройки и новые ЖК',
      'Дороги, развязки, транспортные изменения',
      'Госзакупки и ранние признаки развития территории',
      'Коммерческий потенциал локации',
      'Горизонт развития до 10 лет',
      'Итоговое решение: брать / не брать / проверять глубже',
      'Следующий шаг',
    ]);
    expect(structure.sections.filter(section => section.disclosure === 'paid_detail')).toHaveLength(29);
    expect(JSON.stringify(structure)).toContain(PAID_REPORT_TEN_YEAR_HORIZON_RU);
    expect(PAID_REPORT_TEN_YEAR_HORIZON_RU).toContain('госзакупки');
    expect(structure.cta).toMatchObject({
      primaryLabel: 'Подключить управление',
      secondaryLabel: 'Обсудить объект',
    });
  });

  it('keeps the public gallery compact while the paid inventory stays expanded', () => {
    const free = buildLocationReportStructureViewModel('free');
    const paidDetailCount = paidLocationReportStructureSections.filter(
      section => section.disclosure === 'paid_detail',
    ).length;

    expect(PUBLIC_PAID_REPORT_GALLERY_SECTION_IDS).toHaveLength(7);
    expect(free.paidPreviewSections?.map(section => section.id)).toEqual([
      ...PUBLIC_PAID_REPORT_GALLERY_SECTION_IDS,
    ]);
    expect(paidDetailCount).toBeGreaterThanOrEqual(24);
    expect(paidDetailCount).toBeLessThan(paidLocationReportStructureSections.length);
    expect(
      paidLocationReportStructureSections.some(section => section.id === 'tenYearDevelopmentHorizon'),
    ).toBe(true);
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
