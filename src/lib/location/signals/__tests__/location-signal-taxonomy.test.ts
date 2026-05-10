import { describe, it, expect } from 'vitest';
import type { MagnetItem } from '../../types';
import {
  classifyMagnetSignal,
  isMustSurfaceAnchor,
  getMustSurfaceAnchors,
  getCredibleAnchorsByDomain,
} from '../location-signal-taxonomy';

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

describe('location signal taxonomy contract', () => {
  it('person-name office is weak_local_signal and never unlocks BUSINESS', () => {
    const m = magnet({
      categoryId: 'business',
      name: 'Иванов И.И.',
      distance: 130,
      subType: 'office',
    });

    const t = classifyMagnetSignal(m);
    expect(t.level).toBe('weak_local_signal');
    expect(t.domain).toBe('business');
    expect(t.allowsBusinessAudience).toBe(false);
    expect(t.publicClaimStrength).toBe('hidden_from_public_copy');
  });

  it('bank/insurance is weak_local_signal and hidden from public copy', () => {
    const bank = classifyMagnetSignal(magnet({
      categoryId: 'business',
      name: 'Сбербанк',
      distance: 220,
      subType: 'bank',
    }));
    expect(bank.level).toBe('weak_local_signal');
    expect(bank.allowsBusinessAudience).toBe(false);
    expect(bank.publicClaimStrength).toBe('hidden_from_public_copy');

    const ins = classifyMagnetSignal(magnet({
      categoryId: 'business',
      name: 'Ингосстрах',
      distance: 260,
      subType: 'insurance',
    }));
    expect(ins.level).toBe('weak_local_signal');
    expect(ins.allowsBusinessAudience).toBe(false);
    expect(ins.publicClaimStrength).toBe('hidden_from_public_copy');
  });

  it('named business center is tier1_anchor and unlocks BUSINESS', () => {
    const bc = classifyMagnetSignal(magnet({
      categoryId: 'business',
      name: 'Бизнес-центр «Сити Плаза»',
      distance: 240,
      subType: 'office',
      strengthClass: 'strong',
    }));
    expect(bc.level).toBe('tier1_anchor');
    expect(bc.allowsBusinessAudience).toBe(true);
    expect(bc.publicClaimStrength).toBe('strong_driver_allowed');
  });

  // ── Domain anchor validity (per-domain weak vs credible) ─────────────────

  it('corporate / industrial / factory museum is weak_local_signal in tourist domain', () => {
    const t = classifyMagnetSignal(magnet({
      categoryId: 'attraction',
      name: 'Музей истории завода «Красный треугольник»',
      distance: 140,
    }));
    expect(t.level).toBe('weak_local_signal');
    expect(t.domain).toBe('tourist');
    expect(t.publicClaimStrength).not.toBe('strong_driver_allowed');
    expect(t.publicClaimStrength).not.toBe('moderate_driver_allowed');
  });

  it('small clinic / dentistry tagged as hospital is weak_local_signal in medical domain', () => {
    const t = classifyMagnetSignal(magnet({
      categoryId: 'hospital',
      name: 'Стоматология «Улыбка»',
      distance: 200,
      weight: 2,
    }));
    expect(t.level).toBe('weak_local_signal');
    expect(t.domain).toBe('medical');
    expect(t.allowsBusinessAudience).toBe(false);
    expect(t.publicClaimStrength).not.toBe('strong_driver_allowed');
  });

  it('large hospital remains tier1_anchor in medical domain', () => {
    const t = classifyMagnetSignal(magnet({
      categoryId: 'hospital',
      name: 'Городская клиническая больница №3',
      distance: 350,
      weight: 5,
    }));
    expect(t.level).toBe('tier1_anchor');
    expect(t.domain).toBe('medical');
    expect(t.allowsBusinessAudience).toBe(true);
  });

  it('school / kindergarten tagged as university is weak_local_signal in education', () => {
    const school = classifyMagnetSignal(magnet({
      categoryId: 'university',
      name: 'Школа №42',
      distance: 180,
    }));
    expect(school.level).toBe('weak_local_signal');
    expect(school.domain).toBe('education');
    expect(school.allowsBusinessAudience).toBe(false);

    const kg = classifyMagnetSignal(magnet({
      categoryId: 'university',
      name: 'Детский сад «Ромашка»',
      distance: 140,
    }));
    expect(kg.level).toBe('weak_local_signal');
    expect(kg.domain).toBe('education');
  });

  it('single small hotel / hostel is weak_local_signal in hospitality', () => {
    const hostel = classifyMagnetSignal(magnet({
      categoryId: 'major_hotel',
      name: 'Хостел Сова',
      distance: 240,
    }));
    expect(hostel.level).toBe('weak_local_signal');
    expect(hostel.domain).toBe('hospitality');

    const mid = classifyMagnetSignal(magnet({
      categoryId: 'mid_hotel',
      name: 'Гостиница Вечер',
      distance: 320,
    }));
    expect(mid.level).toBe('weak_local_signal');
    expect(mid.domain).toBe('hospitality');
  });

  it('ZAGS / local administration is weak civic and never unlocks BUSINESS or TOURIST', () => {
    const zags = classifyMagnetSignal(magnet({
      categoryId: 'civic',
      name: 'ЗАГС Кировского района',
      distance: 220,
    }));
    expect(zags.level).toBe('weak_local_signal');
    expect(zags.domain).toBe('civic');
    expect(zags.allowsBusinessAudience).toBe(false);
    expect(zags.publicClaimStrength).not.toBe('strong_driver_allowed');
  });

  it('local mini-market tagged as shopping_major is weak retail signal', () => {
    const t = classifyMagnetSignal(magnet({
      categoryId: 'shopping_major',
      name: 'Магазин у дома',
      distance: 120,
    }));
    expect(t.level).toBe('weak_local_signal');
    expect(t.domain).toBe('retail');
    expect(t.allowsBusinessAudience).toBe(false);
  });

  it('major mall / TRC remains a credible tourist anchor', () => {
    const t = classifyMagnetSignal(magnet({
      categoryId: 'shopping_major',
      name: 'ТРЦ «Мега Парнас»',
      distance: 600,
      weight: 5,
    }));
    expect(t.level === 'tier1_anchor' || t.level === 'tier2_anchor').toBe(true);
    expect(t.domain).toBe('tourist');
  });
});

describe('anchor recall — must-surface helpers', () => {
  it('railway station within 1500m is must-surface', () => {
    expect(isMustSurfaceAnchor(magnet({
      categoryId: 'railway_station', name: 'Московский вокзал', distance: 900,
    }))).toBe(true);
  });

  it('railway station beyond 1500m is NOT must-surface', () => {
    expect(isMustSurfaceAnchor(magnet({
      categoryId: 'railway_station', name: 'Московский вокзал', distance: 2000,
    }))).toBe(false);
  });

  it('weak/local POIs are never must-surface', () => {
    expect(isMustSurfaceAnchor(magnet({
      categoryId: 'business', name: 'Иванов И.И.', distance: 100, subType: 'office',
    }))).toBe(false);
    expect(isMustSurfaceAnchor(magnet({
      categoryId: 'attraction', name: 'Музей истории завода', distance: 140,
    }))).toBe(false);
    expect(isMustSurfaceAnchor(magnet({
      categoryId: 'hospital', name: 'Стоматология «Улыбка»', distance: 200, weight: 2,
    }))).toBe(false);
  });

  it('non-CBD metro is not must-surface; CBD metro is', () => {
    expect(isMustSurfaceAnchor(magnet({
      categoryId: 'metro', name: 'Купчино', distance: 400,
    }))).toBe(false);
    expect(isMustSurfaceAnchor(magnet({
      categoryId: 'metro', name: 'Деловой центр (Москва-Сити)', distance: 400,
    }))).toBe(true);
  });

  it('getMustSurfaceAnchors returns nearest-first credible anchors only', () => {
    const list = getMustSurfaceAnchors([
      magnet({ categoryId: 'railway_station', name: 'Московский вокзал', distance: 900 }),
      magnet({
        categoryId: 'strategicTransportHub',
        name: 'Шереметьево',
        distance: 6000,
        subType: 'airport',
        strategicReachBand: 'strategic',
      }),
      magnet({ categoryId: 'business', name: 'Иванов И.И.', distance: 100, subType: 'office' }),
      magnet({ categoryId: 'attraction', name: 'Музей истории завода', distance: 120 }),
    ]);
    expect(list.map(m => m.name)).toEqual(['Московский вокзал', 'Шереметьево']);
  });

  it('distant airport category POI is not must-surface (handled via strategicTransportHub)', () => {
    expect(isMustSurfaceAnchor(magnet({
      categoryId: 'airport', name: 'Пулково', distance: 6000,
    }))).toBe(false);
  });

  it('getCredibleAnchorsByDomain groups credible magnets and excludes weak/hidden', () => {
    const grouped = getCredibleAnchorsByDomain([
      magnet({ categoryId: 'railway_station', name: 'Московский вокзал', distance: 900 }),
      magnet({ categoryId: 'business', name: 'Иванов И.И.', distance: 100, subType: 'office' }),
      magnet({ categoryId: 'business', name: 'Бизнес-центр «Сити»', distance: 500, subType: 'office' }),
      magnet({ categoryId: 'attraction', name: 'Эрмитаж', distance: 700, weight: 6 }),
      magnet({ categoryId: 'attraction', name: 'Музей истории завода', distance: 140 }),
    ]);
    expect(grouped.transport.map(m => m.name)).toContain('Московский вокзал');
    expect(grouped.business.map(m => m.name)).toContain('Бизнес-центр «Сити»');
    expect(grouped.business.map(m => m.name)).not.toContain('Иванов И.И.');
    expect(grouped.tourist.map(m => m.name)).toContain('Эрмитаж');
    expect(grouped.tourist.map(m => m.name)).not.toContain('Музей истории завода');
  });
});

