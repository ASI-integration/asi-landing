import { describe, it, expect } from 'vitest';
import type { MagnetItem } from '../types';
import {
  GENERATED_MAGNET_REGISTRY,
  classifyCanonicalMagnet,
  type CanonicalMagnetType,
} from '../canonical/magnet-registry';

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

describe('canonical magnet registry matrix', () => {
  it('contains all major required magnet families', () => {
    const required: CanonicalMagnetType[] = [
      'railway_station',
      'metro_station',
      'transport_hub',
      'airport',
      'port',
      'industrial_anchor',
      'industrial_zone',
      'business_center',
      'office_cluster',
      'hospital',
      'medical_cluster',
      'university',
      'shopping_mall',
      'park',
      'beach',
      'waterfront',
      'resort_area',
      'stadium',
      'event_venue',
      'cultural_landmark',
      'museum',
      'theater',
      'tourist_attraction',
      'hotel_cluster',
      'residential_density',
      'weak_amenity',
      'tertiary_local_amenity',
    ];
    for (const k of required) {
      expect(GENERATED_MAGNET_REGISTRY[k]).toBeTruthy();
    }
  });

  it('railway station: tier1 transport, business allowed', () => {
    const d = classifyCanonicalMagnet({ magnet: magnet({ categoryId: 'railway_station', name: 'Московский вокзал', distance: 650 }) });
    expect(d.family).toBe('railway_station');
    expect(d.anchorStrength).toBe('tier1');
    expect(d.maxResidentialTier).toBe(1);
    expect(d.audiences.business).toBe(true);
    expect(d.public.labelRu.toLowerCase()).toContain('вокзал');
  });

  it('airport: tier1 transport, long must-surface radius (contract)', () => {
    const d = classifyCanonicalMagnet({ magnet: magnet({ categoryId: 'airport', name: 'Шереметьево', distance: 4500 }) });
    expect(d.family).toBe('airport');
    expect(d.anchorStrength).toBe('tier1');
    expect(d.maxResidentialTier).toBe(1);
  });

  it('metro: not business-unlocking unless CBD context', () => {
    const ordinary = classifyCanonicalMagnet({ magnet: magnet({ categoryId: 'metro', name: 'Невский проспект', distance: 600 }) });
    expect(ordinary.family).toBe('metro_station');
    expect(ordinary.anchorStrength).toBe('tier2');
    expect(ordinary.audiences.business).toBe(false);

    const cbd = classifyCanonicalMagnet({ magnet: magnet({ categoryId: 'metro', name: 'Деловой центр', distance: 640 }) });
    expect(cbd.family).toBe('metro_station');
    expect(cbd.anchorStrength).toBe('tier1');
    expect(cbd.audiences.business).toBe(true);
  });

  it('industrial zone: mixed context, not tier1 residential', () => {
    const d = classifyCanonicalMagnet({ magnet: magnet({ categoryId: 'business', subType: 'industrial', name: 'Промзона', distance: 650 }) });
    expect(d.family).toBe('industrial_zone');
    expect(d.maxResidentialTier).not.toBe(1);
    expect(d.audiences.industrialWorker).toBe(true);
  });

  it('business center by name: tier1 business', () => {
    const d = classifyCanonicalMagnet({ magnet: magnet({ categoryId: 'business', subType: 'office', name: 'Бизнес-центр Сенатор', distance: 450 }) });
    expect(d.family).toBe('business_center');
    expect(d.anchorStrength).toBe('tier1');
    expect(d.audiences.business).toBe(true);
    expect(d.maxResidentialTier).toBe(1);
  });

  it('generic museum/theater cannot be tier1 residential by name/category alone', () => {
    const museum = classifyCanonicalMagnet({ magnet: magnet({ categoryId: 'attraction', name: 'Музей', distance: 300 }) });
    expect(museum.family).toBe('museum');
    expect(museum.maxResidentialTier).not.toBe(1);

    const theater = classifyCanonicalMagnet({ magnet: magnet({ categoryId: 'attraction', name: 'Театр', distance: 300 }) });
    expect(theater.family).toBe('theater');
    expect(theater.maxResidentialTier).not.toBe(1);
  });

  it('corporate/industrial museum downgrades to weak context (anti-signal)', () => {
    const d = classifyCanonicalMagnet({ magnet: magnet({ categoryId: 'attraction', name: 'Музей истории завода', distance: 140 }) });
    expect(d.family).toBe('museum');
    expect(d.anchorStrength).toBe('weak');
    expect(d.maxResidentialTier).toBe(3);
  });

  it('weak local amenity never tier1', () => {
    const d = classifyCanonicalMagnet({ magnet: magnet({ categoryId: 'food', name: 'Кафе', distance: 90 }) });
    expect(d.family).toBe('weak_amenity');
    expect(d.maxResidentialTier).toBe(3);
  });
});

