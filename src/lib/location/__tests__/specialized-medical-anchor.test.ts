import { describe, it, expect } from 'vitest';
import {
  qualifiesSpecializedMedicalAnchor,
  inferSpecializedMedicalSubType,
  specializedMedicalReachBandFromDistance,
  SPECIALIZED_MEDICAL_FETCH_RADIUS_M,
  ORDINARY_HOSPITAL_SCORING_RADIUS_M,
} from '../specialized-medical-anchor';

describe('specializedMedicalAnchor helpers', () => {
  it('qualifies major hospitals but not cosmetic dentist offices', () => {
    expect(
      qualifiesSpecializedMedicalAnchor({
        amenity: 'hospital',
        name: 'Детская городская больница № 1',
      }),
    ).toBe(true);
    expect(
      qualifiesSpecializedMedicalAnchor({
        amenity: 'dentist',
        name: 'Стоматология «Улыбка»',
      }),
    ).toBe(false);
    expect(
      qualifiesSpecializedMedicalAnchor({
        amenity: 'dentist',
        name: 'Отделение челюстно-лицевой хирургии',
      }),
    ).toBe(true);
  });

  it('infers children hospital subtype from Russian names', () => {
    expect(
      inferSpecializedMedicalSubType({ amenity: 'hospital', name: 'Детская больница им. Раухфуса' }),
    ).toBe('children_hospital');
  });

  it('reach bands cover primary and secondary without widening ordinary hospital radius', () => {
    expect(specializedMedicalReachBandFromDistance(900)).toBe('primary');
    expect(specializedMedicalReachBandFromDistance(ORDINARY_HOSPITAL_SCORING_RADIUS_M)).toBe('primary');
    expect(specializedMedicalReachBandFromDistance(2000)).toBe('secondary');
    expect(specializedMedicalReachBandFromDistance(SPECIALIZED_MEDICAL_FETCH_RADIUS_M)).toBe('secondary');
    expect(specializedMedicalReachBandFromDistance(SPECIALIZED_MEDICAL_FETCH_RADIUS_M + 50)).toBe(null);
  });
});
