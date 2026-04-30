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
});

