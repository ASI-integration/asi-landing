/**
 * Large / specialized healthcare anchors beyond ordinary local hospital fetch (1 km).
 * Scored modestly so overall scores do not inflate from distant clinics.
 */

import type { MagnetItem } from './types';

export const SPECIALIZED_MEDICAL_PRIMARY_RADIUS_M = 1500;
export const SPECIALIZED_MEDICAL_SECONDARY_RADIUS_M = 3000;
export const SPECIALIZED_MEDICAL_FETCH_RADIUS_M = SPECIALIZED_MEDICAL_SECONDARY_RADIUS_M;

/** Ordinary hospital magnet radius — unchanged from CATEGORY_RADIUS.hospital */
export const ORDINARY_HOSPITAL_SCORING_RADIUS_M = 1000;

export type SpecializedMedicalSubType =
  | 'hospital'
  | 'children_hospital'
  | 'surgery_department'
  | 'dental_surgery'
  | 'maternity_hospital'
  | 'oncology'
  | 'emergency'
  | 'medical_center_nii';

export type SpecializedMedicalReachBand = 'primary' | 'secondary';

const WEAK_FACILITY_NAME_RE =
  /косметолог|салон\s+красоты|красоты|аптек|ветеринар|лаборатор(?:ия)?|медицинский\s+кабинет|(?:^|\s)кабинет(?:$|\s)/i;

const STRONG_HOSPITAL_NAME_RE =
  /больниц|госпитал|поликлиник|медицинский\s+центр|клиническая|перинатальн|роддом|онкологическ|кардиологическ|(?:^|\s)нии(?:$|\s|\W)|научно-исследовательск|стационар|детск(?:ая|ой|ие)|children|pediatric|онко|хирург|травмпункт|приёмн(?:ое|ая)|emergency|стоматолог(?:ическая)?\s+хирург/i;

function nameLower(tags: Record<string, string>): string {
  return (tags.name ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * True when this POI should be eligible for specializedMedicalAnchor scoring
 * when beyond ordinary hospital radius (distance checked by caller).
 */
export function qualifiesSpecializedMedicalAnchor(tags: Record<string, string>): boolean {
  const n = nameLower(tags);
  const amenity = tags.amenity;
  const healthcare = tags.healthcare;

  if (amenity === 'pharmacy' || amenity === 'beauty_salon') return false;
  if (WEAK_FACILITY_NAME_RE.test(n) && !STRONG_HOSPITAL_NAME_RE.test(n)) return false;

  if (amenity === 'hospital' || healthcare === 'hospital') {
    if (WEAK_FACILITY_NAME_RE.test(n) && !STRONG_HOSPITAL_NAME_RE.test(n)) return false;
    return true;
  }

  if (healthcare === 'surgery') return true;

  if (amenity === 'clinic') {
    if (healthcare === 'surgery' || healthcare === 'hospital') return true;
    if (/хирург|oncolog|онколог|роддом|maternity|травмпункт|приёмн|emergency/i.test(n)) return true;
    return false;
  }

  if (amenity === 'dentist') {
    if (/хирург|maxillofacial|oral\s*surgery|стоматолог(?:ическая)?\s+хирург/i.test(n)) return true;
    if (healthcare === 'surgery') return true;
    return false;
  }

  if (amenity === 'social_facility' && (healthcare === 'maternity' || healthcare === 'hospital')) return true;

  return false;
}

export function inferSpecializedMedicalSubType(tags: Record<string, string>): SpecializedMedicalSubType {
  const n = nameLower(tags);
  const spec = (tags['healthcare:speciality'] ?? '').toLowerCase();

  if (tags.amenity === 'dentist') return 'dental_surgery';

  if (/детск|children|pediatric|paediatric/.test(n) || spec.includes('paediatric') || spec.includes('pediatric')) {
    return 'children_hospital';
  }
  if (/онколог|oncolog/.test(n) || spec.includes('oncolog')) return 'oncology';
  if (/роддом|maternity|перинатальн/.test(n) || tags.healthcare === 'maternity') return 'maternity_hospital';
  if (/травмпункт|приёмн|emergency|реанимац/.test(n) || tags.emergency === 'yes') return 'emergency';
  if (/стоматолог.*хирург|хирург.*стоматолог|oral\s*surgery|maxillofacial/.test(n)) {
    return 'dental_surgery';
  }
  if (/хирург|surgery\s+dep/.test(n) || tags.healthcare === 'surgery') return 'surgery_department';
  if (/(?:^|\s)нии(?:$|\s|\W)|научно-исследовательск|институт\s/.test(n)) return 'medical_center_nii';
  return 'hospital';
}

export function specializedMedicalReachBandFromDistance(distanceM: number): SpecializedMedicalReachBand | null {
  if (!Number.isFinite(distanceM) || distanceM > SPECIALIZED_MEDICAL_FETCH_RADIUS_M) return null;
  return distanceM <= SPECIALIZED_MEDICAL_PRIMARY_RADIUS_M ? 'primary' : 'secondary';
}

/** Tier multiplier on category weight — keep distant anchors subdued */
export function specializedMedicalWeightTierMultiplier(band: SpecializedMedicalReachBand): number {
  return band === 'primary' ? 0.5 : 0.26;
}

export function specializedMedicalSubtypeLabelRu(subType: string | undefined): string {
  switch (subType) {
    case 'children_hospital':
      return 'Детская больница';
    case 'surgery_department':
      return 'Хирургическое отделение / хирургия';
    case 'dental_surgery':
      return 'Стоматологическая хирургия';
    case 'maternity_hospital':
      return 'Родильный дом / перинатальный центр';
    case 'oncology':
      return 'Онкологический центр';
    case 'emergency':
      return 'Травмпункт / приёмное отделение';
    case 'medical_center_nii':
      return 'Крупный медицинский центр / НИИ';
    case 'hospital':
    default:
      return 'Больница / стационар';
  }
}

/** Free tier — one short line only when a credible anchor exists */
export function specializedMedicalFreeBriefRu(
  magnets: Array<{ categoryId: string; specializedMedicalReachBand?: SpecializedMedicalReachBand }>,
): string | null {
  const anchors = magnets.filter(
    m =>
      m.categoryId === 'specializedMedicalAnchor' &&
      (m.specializedMedicalReachBand === 'primary' || m.specializedMedicalReachBand === 'secondary'),
  );
  if (anchors.length === 0) return null;
  return 'Крупная медицина в зоне доступности.';
}

export function specializedMedicalPaidDetailLinesRu(magnets: MagnetItem[]): string[] {
  const lines: string[] = [];
  for (const m of magnets) {
    if (m.categoryId !== 'specializedMedicalAnchor') continue;
    const band = m.specializedMedicalReachBand;
    if (!band) continue;
    const kind = specializedMedicalSubtypeLabelRu(m.subType);
    const distRu =
      m.distance < 1000
        ? `примерно ${Math.round(m.distance / 10) * 10} м`
        : `примерно ${(m.distance / 1000).toFixed(1)} км`;
    const access =
      band === 'secondary' || m.distance > 1200
        ? ' Это не пеший якорь для гостей: спрос формируют сопровождающие и длительные визиты на машине/транспорте.'
        : ' Пешая доступность ограничена — для гостей важна связка на транспорте.';
    const demand =
      ' Устойчивый побочный спрос от пациентов и сопровождающих повышает занятость в среднесроке, но не заменяет туристический или деловой якорь.';
    lines.push(`Крупная медицина в зоне доступности: ${kind} — ${m.name} (${distRu}).${demand}${access}`);
  }
  return lines;
}
