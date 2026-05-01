import { describe, it, expect } from 'vitest';
import type { MagnetItem } from '../types';
import { buildAudienceAnalysis } from '../audience-scoring';
import { generateConclusion } from '../explanation';

function magnet(p: Partial<MagnetItem> & Pick<MagnetItem, 'categoryId' | 'name' | 'distance'>): MagnetItem {
  return {
    categoryLabel: p.categoryId,
    icon: '•',
    lat: 0,
    lon: 0,
    weight: p.weight ?? 4,
    permanenceType: p.permanenceType ?? 'permanent',
    scopeLevel: p.scopeLevel ?? 'local',
    strengthClass: p.strengthClass ?? 'medium',
    attractionScore: p.attractionScore ?? 3,
    ...p,
  };
}

describe('location taxonomy integration — weak/local POIs cannot become strong public drivers', () => {
  it('person-name office at 130m cannot produce BUSINESS or strong wording', () => {
    const magnets: MagnetItem[] = [
      magnet({ categoryId: 'business', name: 'Иванов И.И.', distance: 130, subType: 'office' }),
      magnet({ categoryId: 'food', name: 'Кафе', distance: 90 }),
    ];
    const aa = buildAudienceAnalysis(magnets);
    expect(aa.primaryAudience).not.toBe('BUSINESS');
    expect(aa.businessClusterDetected).toBe(false);

    // Primary label must never leak strong business copy.
    const l = aa.primaryDriverLabel.toLowerCase();
    expect(l).not.toContain('основной драйвер');
    expect(l).not.toContain('кластер деловых объектов');
    expect(l).not.toContain('стабильный поток командированных');
    expect(l).not.toContain('сильный коммерческий профиль');

    const conclusion = generateConclusion(
      55,
      magnets,
      [],
      { business: 1, food: 1 },
      {
        dominantMagnets: [],
        strongestZoneLabel: '',
        competitorPressureLevel: 'low',
        demandDistribution: 'weak',
        demandType: 'mixed',
        clusterDetected: false,
        clusterSize: 0,
        scoreBreakdown: {
          attraction: 0,
          competitorPressure: 0,
          clusterBonus: 0,
          trafficBoost: 0,
        },
      },
      'ru',
      aa,
    );
    const c = conclusion.toLowerCase();
    expect(c).not.toContain('стабильный поток командированных');
    expect(c).not.toContain('кластер деловых объектов');
  });

  it('bank/insurance alone cannot produce BUSINESS or a "business cluster"', () => {
    const magnets: MagnetItem[] = [
      magnet({ categoryId: 'business', name: 'Сбербанк', distance: 210, subType: 'bank' }),
      magnet({ categoryId: 'business', name: 'Ингосстрах', distance: 260, subType: 'insurance' }),
    ];
    const aa = buildAudienceAnalysis(magnets);
    expect(aa.primaryAudience).not.toBe('BUSINESS');
    expect(aa.businessClusterDetected).toBe(false);
  });

  it('weak office cluster cannot produce "кластер деловых объектов" wording', () => {
    const magnets: MagnetItem[] = [
      magnet({ categoryId: 'business', name: 'Офис', distance: 220, subType: 'office' }),
      magnet({ categoryId: 'business', name: 'Банк', distance: 260, subType: 'bank' }),
      magnet({ categoryId: 'business', name: 'Страхование', distance: 310, subType: 'insurance' }),
    ];
    const aa = buildAudienceAnalysis(magnets);
    expect(aa.primaryAudience).not.toBe('BUSINESS');
    expect(aa.primaryDriverLabel.toLowerCase()).not.toContain('кластер деловых объектов');
  });

  // ── Per-domain anchor validity regressions ────────────────────────────────

  function gravityStub() {
    return {
      dominantMagnets: [],
      strongestZoneLabel: '',
      competitorPressureLevel: 'low' as const,
      demandDistribution: 'weak' as const,
      demandType: 'mixed' as const,
      clusterDetected: false,
      clusterSize: 0,
      scoreBreakdown: { attraction: 0, competitorPressure: 0, clusterBonus: 0, trafficBoost: 0 },
    };
  }

  it('corporate museum at 140m alone is not a strong tourist driver', () => {
    const magnets: MagnetItem[] = [
      magnet({ categoryId: 'attraction', name: 'Музей истории завода', distance: 140 }),
    ];
    const aa = buildAudienceAnalysis(magnets);
    expect(aa.audienceFitScore).toBeLessThan(70);
    expect(aa.primaryDriverLabel).toContain('сильный туристический поток не подтверждён');

    const conclusion = generateConclusion(85, magnets, [], { attraction: 1 }, gravityStub(), 'ru', aa);
    const c = conclusion.toLowerCase();
    expect(c).not.toContain('сильная туристическая локация');
    expect(c).not.toContain('основной драйвер');
  });

  it('single small clinic is not a strong medical driver', () => {
    const magnets: MagnetItem[] = [
      magnet({ categoryId: 'hospital', name: 'Стоматология «Улыбка»', distance: 200, weight: 2 }),
    ];
    const aa = buildAudienceAnalysis(magnets);
    const conclusion = generateConclusion(60, magnets, [], { hospital: 1 }, gravityStub(), 'ru', aa);
    const c = conclusion.toLowerCase();
    expect(c).not.toContain('медицинский кластер');
    expect(c).not.toContain('медкластер');
    expect(aa.audienceFitScore).toBeLessThan(70);
  });

  it('school/kindergarten only does not unlock strong education wording', () => {
    const magnets: MagnetItem[] = [
      magnet({ categoryId: 'university', name: 'Школа №42', distance: 180 }),
    ];
    const aa = buildAudienceAnalysis(magnets);
    const conclusion = generateConclusion(60, magnets, [], { university: 1 }, gravityStub(), 'ru', aa);
    const c = conclusion.toLowerCase();
    expect(c).not.toContain('студенческий поток');
    expect(c).not.toContain('сильная образовательная локация');
  });

  it('single small hotel is not a strong tourist/hospitality anchor', () => {
    const magnets: MagnetItem[] = [
      magnet({ categoryId: 'mid_hotel', name: 'Хостел Сова', distance: 240 }),
    ];
    const aa = buildAudienceAnalysis(magnets);
    expect(aa.audienceFitScore).toBeLessThan(70);
    const conclusion = generateConclusion(85, magnets, [], { mid_hotel: 1 }, gravityStub(), 'ru', aa);
    expect(conclusion.toLowerCase()).not.toContain('сильная туристическая локация');
  });

  it('ZAGS / local civic office only is not BUSINESS and not strong tourist', () => {
    const magnets: MagnetItem[] = [
      magnet({ categoryId: 'civic', name: 'ЗАГС Кировского района', distance: 220 }),
    ];
    const aa = buildAudienceAnalysis(magnets);
    expect(aa.primaryAudience).not.toBe('BUSINESS');
    expect(aa.businessClusterDetected).toBe(false);
    const conclusion = generateConclusion(85, magnets, [], { civic: 1 }, gravityStub(), 'ru', aa);
    const c = conclusion.toLowerCase();
    expect(c).not.toContain('сильная туристическая локация');
    expect(c).not.toContain('сильная локация для командированных');
  });

  it('local mini-market only is not a strong retail driver', () => {
    const magnets: MagnetItem[] = [
      magnet({ categoryId: 'shopping_major', name: 'Магазин у дома', distance: 120 }),
    ];
    const aa = buildAudienceAnalysis(magnets);
    expect(aa.audienceFitScore).toBeLessThan(70);
    const conclusion = generateConclusion(85, magnets, [], { shopping_major: 1 }, gravityStub(), 'ru', aa);
    expect(conclusion.toLowerCase()).not.toContain('сильная туристическая локация');
  });
});

