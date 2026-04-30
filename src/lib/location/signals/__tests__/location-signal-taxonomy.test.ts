import { describe, it, expect } from 'vitest';
import type { MagnetItem } from '../../types';
import { classifyMagnetSignal } from '../location-signal-taxonomy';

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
});

