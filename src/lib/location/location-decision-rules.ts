/**
 * Pure rules for Location Decision Kernel — role/tier mapping, address subject heuristics, copy helpers.
 */

import type { MagnetItem, OSMElement } from './types';
import { MAGNET_CATEGORIES } from './config';
import { classifyElement } from './overpass-classify';
import { looksLikeWeakLocalAttractionPoi } from './signals/location-signal-taxonomy';
import { PORT_LOGISTICS_DEMAND_EXPLANATION_RU } from './strategic-transport-hub';
import type {
  AddressIdentity,
  CanonicalLocationFact,
  DemandSignal,
  DemandSignalStrength,
  LocationAnalysisSubjectType,
  LocationEvidenceItem,
  MagnetFact,
  MagnetRole,
  MagnetTier,
} from './location-decision-contract';

/** Cyrillic-safe (avoid ASCII-only `\b` word boundaries for RU tokens) */
const RU_STREET_TOKEN =
  /(?:^|[\s,])(ул\.?|улица|просп\.?|проспект|пер\.?|переулок|наб\.?|набережная|ш\.|шоссе|бул\.?|бульвар|пл\.?|площадь|пр-д|проезд|аллея|линия)(?=[\s,.]|$)/i;

/** Heuristic: user typed a postal-style street + house → analysis subject stays address/building, not POI. */
export function inferStreetHouseSubjectType(rawAddress: string): LocationAnalysisSubjectType {
  const s = (rawAddress ?? '').trim();
  if (!s) return 'ambiguous';
  const hasDigit = /\d/.test(s);
  if (!hasDigit) return 'ambiguous';
  if (RU_STREET_TOKEN.test(s)) return 'address';
  return 'ambiguous';
}

export function resolveAnalysisSubjectType(args: {
  inputAddress: string;
  geocodeSubjectHint?: 'address' | 'poi' | 'ambiguous';
}): LocationAnalysisSubjectType {
  const streetHouse = inferStreetHouseSubjectType(args.inputAddress);
  if (streetHouse === 'address') return 'address';

  const hint = args.geocodeSubjectHint;
  if (hint === 'poi') return 'poi';
  if (hint === 'address') return 'address';

  return hint === 'ambiguous' ? 'ambiguous' : streetHouse;
}

export function buildAddressIdentity(args: {
  inputAddress: string;
  coordinates: { lat: number; lon: number };
  geocodeSubjectHint?: 'address' | 'poi' | 'ambiguous';
  /** Future: POIs returned by geocoder at same coordinate — fill when provider exposes them */
  sameAddressPois?: ReadonlyArray<{ name: string; categoryHint?: string }>;
}): AddressIdentity {
  const warnings: string[] = [];
  const subjectType = resolveAnalysisSubjectType({
    inputAddress: args.inputAddress,
    geocodeSubjectHint: args.geocodeSubjectHint,
  });

  if (subjectType === 'address' && args.geocodeSubjectHint === 'poi') {
    warnings.push(
      'kernel: street-style address input overrides POI geocode hint — subject remains address/building; POIs become magnets only.',
    );
  }

  return {
    subjectType,
    selectedAddressPoint: { ...args.coordinates },
    selectedPoiAtSameAddress: args.sameAddressPois ?? [],
    warnings,
  };
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function categoryMeta(categoryId: string) {
  return MAGNET_CATEGORIES.find(c => c.id === categoryId);
}

function tierFromMagnet(m: MagnetItem): MagnetTier {
  if (m.strengthClass === 'strong') return 'primary';
  if (m.strengthClass === 'medium') return 'secondary';
  return 'weak';
}

/** Recover category id segment from `mf:<idx>:<categoryId>:<dist>` */
function magnetCategoryIdFromFactId(factId: string): string {
  const parts = factId.split(':');
  return parts.length >= 3 ? parts[2]! : '';
}

function informativeEvidenceNameRu(name: string | undefined, categoryId: string): boolean {
  const n = (name ?? '').trim().toLowerCase();
  if (!n && categoryId !== 'metro') return false;
  if (categoryId === 'attraction' && (n === 'достопримечательность' || !n)) return false;
  return true;
}

/**
 * True when ≥2 independent event/leisure anchors (entertainment / stadium / convention)
 * sit within walking distance — enough to treat nearby attractions as tourist demand evidence.
 * Hotels and offices never substitute for this cluster (taxonomy/eligibility only).
 */
export function hasTouristAnchorCluster(magnets: readonly MagnetItem[]): boolean {
  const anchors = magnets.filter(
    x =>
      ['entertainment', 'stadium', 'convention'].includes(x.categoryId) && x.distance <= 1200,
  );
  return anchors.length >= 2;
}

export function magnetRoleFromCategory(
  m: MagnetItem,
  magnets: readonly MagnetItem[],
): { role: MagnetRole; tier: MagnetTier } {
  let tier = tierFromMagnet(m);

  if (m.categoryId === 'metro' || m.categoryId === 'railway_station') {
    return { role: 'accessibility', tier: tier === 'primary' ? 'secondary' : tier };
  }

  if (m.categoryId === 'strategicTransportHub' || m.categoryId === 'airport') {
    if (m.strategicReachBand === 'secondary') tier = 'secondary';
    return { role: 'transport_anchor', tier };
  }

  if (m.categoryId === 'hospital' || m.categoryId === 'specializedMedicalAnchor') {
    return { role: 'medical_demand', tier };
  }

  if (m.categoryId === 'business') {
    return { role: 'business_demand', tier };
  }

  if (['entertainment', 'stadium', 'convention'].includes(m.categoryId)) {
    return { role: 'event_demand', tier };
  }

  if (m.categoryId === 'attraction') {
    if (looksLikeWeakLocalAttractionPoi(m)) {
      return { role: 'local_interest', tier: 'weak' };
    }
    if (hasTouristAnchorCluster(magnets)) {
      return { role: 'tourist_demand', tier: tier === 'weak' ? 'weak' : tier };
    }
    return { role: 'local_interest', tier: 'weak' };
  }

  if (m.categoryId === 'shopping_major' || m.categoryId === 'university') {
    return { role: 'business_demand', tier };
  }

  /** Hotels / serviced apartments: supply context only — not standalone tourist demand evidence */
  if (m.categoryId === 'major_hotel' || m.categoryId === 'mid_hotel') {
    return { role: 'local_interest', tier: 'weak' };
  }

  return { role: 'local_interest', tier: 'weak' };
}

export function formatDistanceRu(meters: number): string {
  if (!Number.isFinite(meters)) return '';
  if (meters < 1000) return `${Math.round(meters / 10) * 10}\u00a0м`;
  const km = meters / 1000;
  const rounded = km >= 10 ? km.toFixed(0) : km.toFixed(1).replace('.', ',');
  return `${rounded}\u00a0км`;
}

function roleTailRu(role: MagnetRole): string {
  switch (role) {
    case 'accessibility':
      return 'плюс к транспортной доступности';
    case 'transport_anchor':
      return 'удобный выезд на дальние направления и пересадки';
    case 'medical_demand':
      return 'медицинское учреждение поблизости';
    case 'business_demand':
      return 'рядом есть учебные или деловые объекты';
    case 'tourist_demand':
      return 'рядом есть точки досуга и интереса';
    case 'event_demand':
      return 'событийный и досуговый спрос в зоне';
    case 'local_interest':
      return 'локальный объект интереса без подтверждённого массового туристического потока';
    default:
      return 'фактор окружения';
  }
}

/** Generic placeholder labels from OSM/classifier — not a station name */
function isGenericMetroEvidenceName(name: string): boolean {
  const n = name.trim().toLowerCase();
  return n === 'метро' || n === 'subway' || n === 'metro';
}

function publicEvidenceDisplayNameRu(mf: MagnetFact): string {
  if (mf.role === 'accessibility' && mf.category.toLowerCase().includes('метро')) {
    if (!mf.name.trim() || isGenericMetroEvidenceName(mf.name)) {
      return 'Станция метро (название не указано в открытых данных)';
    }
  }
  return mf.name.trim();
}

export function formatPublicEvidenceLineRu(mf: MagnetFact): string {
  const dist = formatDistanceRu(mf.distanceMeters);
  if (mf.role === 'transport_anchor' && (mf.subtype === 'port' || mf.subtype === 'river_port')) {
    return `${mf.name} — около ${dist}: ${PORT_LOGISTICS_DEMAND_EXPLANATION_RU}`;
  }
  const tail = roleTailRu(mf.role);
  const label = publicEvidenceDisplayNameRu(mf);
  return `${label} — около ${dist}: ${tail}.`;
}

export function magnetItemToMagnetFact(
  m: MagnetItem,
  idx: number,
  magnets: readonly MagnetItem[],
): MagnetFact {
  const meta = categoryMeta(m.categoryId);
  let { role, tier } = magnetRoleFromCategory(m, magnets);
  /** Walking-distance transit stops must surface as accessibility evidence even when gravity tier is weak */
  if (
    role === 'accessibility' &&
    (m.categoryId === 'metro' || m.categoryId === 'railway_station') &&
    tier === 'weak'
  ) {
    tier = 'secondary';
  }
  const categoryLabel = meta?.labelRu ?? m.categoryLabel ?? m.categoryId;
  const id = `mf:${idx}:${m.categoryId}:${Math.round(m.distance)}`;

  const included =
    m.categoryId !== 'food' &&
    m.categoryId !== 'shopping_local' &&
    m.categoryId !== 'education_local';

  const roleEligiblePublic =
    role !== 'local_interest' && role !== 'competitor' && role !== 'environment_risk';

  const mf: MagnetFact = {
    id,
    name: m.name,
    category: categoryLabel,
    subtype: m.subType,
    tier,
    role,
    distanceMeters: Math.round(m.distance),
    evidenceSource: 'classified_magnet',
    includedInScore: included,
    includedInPublicReport:
      included &&
      (tier === 'primary' || tier === 'secondary') &&
      roleEligiblePublic &&
      informativeEvidenceNameRu(m.name, m.categoryId),
    explanationRu: '',
    explanationEn: '',
    internalWeight: m.weight,
    scoreImpactHint: m.attractionScore,
  };
  mf.explanationRu = formatPublicEvidenceLineRu(mf);
  mf.explanationEn = `${m.name}: ${role.replace(/_/g, ' ')} signal at ~${Math.round(m.distance)} m`;
  return mf;
}

/** Strong/moderate public kernel evidence: tier + role + informative POI name */
export function isStrongPublicEvidenceMagnetFact(f: MagnetFact): boolean {
  return (
    f.includedInPublicReport &&
    (f.tier === 'primary' || f.tier === 'secondary') &&
    f.role !== 'local_interest' &&
    informativeEvidenceNameRu(f.name, magnetCategoryIdFromFactId(f.id)) &&
    Boolean(f.category?.trim()) &&
    Number.isFinite(f.distanceMeters)
  );
}

/** DemandSignal rows are emitted only from MagnetFacts — never from raw prose */
export function demandSignalsFromMagnetFacts(facts: readonly MagnetFact[]): DemandSignal[] {
  const out: DemandSignal[] = [];
  for (const f of facts) {
    if (!f.includedInScore) continue;
    if (f.role === 'local_interest') continue;

    let strength: DemandSignalStrength = 'weak';
    if (f.tier === 'primary') strength = 'strong';
    else if (f.tier === 'secondary') strength = 'moderate';

    const type = `${f.role}_${f.category.replace(/\s+/g, '_').slice(0, 40)}`;

    out.push({
      id: `ds:${f.id}`,
      type,
      strength,
      evidenceFactIds: [f.id],
      reason: f.explanationRu,
      publicLabelRu: f.explanationRu,
      internalReason: `${f.role}:${f.tier}:${f.category}`,
    });
  }

  return out;
}

export function canonicalFactsFromOsmElements(
  elements: readonly OSMElement[],
  origin: { lat: number; lon: number },
): CanonicalLocationFact[] {
  const out: CanonicalLocationFact[] = [];
  for (const el of elements) {
    const cl = classifyElement(el);
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    const dist =
      lat != null && lon != null ? Math.round(haversineMeters(origin.lat, origin.lon, lat, lon)) : undefined;

    if (cl) {
      const meta = categoryMeta(cl.categoryId);
      out.push({
        id: `cf:osm:${el.type}:${el.id}`,
        source: 'osm_overpass',
        name: cl.name,
        category: meta?.labelRu ?? cl.categoryId,
        subtype: cl.subType,
        coordinates: lat != null && lon != null ? { lat, lon } : undefined,
        distanceMeters: dist,
        confidence: 'medium',
        rawTags: el.tags,
        warnings: [],
      });
      continue;
    }

    if ((el.tags?.shop ?? el.tags?.amenity) && lat != null && lon != null) {
      out.push({
        id: `cf:osm:raw:${el.type}:${el.id}`,
        source: 'osm_overpass',
        name: el.tags?.name ?? 'Объект карты',
        category: 'Прочее (неклассифицировано)',
        subtype: el.tags?.amenity ?? el.tags?.shop,
        coordinates: { lat, lon },
        distanceMeters: dist,
        confidence: 'low',
        rawTags: el.tags,
        warnings: ['kernel: unclassified OSM element retained as low-confidence context only'],
      });
    }
  }
  return out;
}

export function canonicalFactsFromMagnetsFallback(magnets: readonly MagnetItem[]): CanonicalLocationFact[] {
  return magnets.map((m, idx) => ({
    id: `cf:mag:${idx}:${m.categoryId}:${Math.round(m.distance)}`,
    source: 'derived_magnet',
    name: m.name,
    category: categoryMeta(m.categoryId)?.labelRu ?? m.categoryLabel,
    subtype: m.subType,
    coordinates: { lat: m.lat, lon: m.lon },
    distanceMeters: Math.round(m.distance),
    confidence: 'high',
    warnings: [],
  }));
}

export function evidenceItemsFromMagnetFacts(
  facts: readonly MagnetFact[],
  max = 5,
): LocationEvidenceItem[] {
  const base = [...facts].filter(
    f =>
      f.includedInScore &&
      f.role !== 'local_interest' &&
      (f.name.trim() || f.role === 'accessibility') &&
      informativeEvidenceNameRu(f.name, magnetCategoryIdFromFactId(f.id)),
  );

  const strongPool = base.filter(isStrongPublicEvidenceMagnetFact);
  const ranked = strongPool.length > 0 ? strongPool : base;

  ranked.sort((a, b) => {
    const tierRank = (t: MagnetTier) =>
      t === 'primary' ? 0 : t === 'secondary' ? 1 : t === 'weak' ? 2 : 3;
    const tr = tierRank(a.tier) - tierRank(b.tier);
    if (tr !== 0) return tr;
    return a.distanceMeters - b.distanceMeters;
  });

  const picked = ranked.slice(0, max);
  return picked.map(mf => ({
    evidenceId: `ev:${mf.id}`,
    factId: mf.id,
    objectName: mf.name,
    typeRu: mf.category,
    subtypeRu: mf.subtype,
    distanceMeters: mf.distanceMeters,
    publicExplanationRu: formatPublicEvidenceLineRu(mf),
  }));
}

export function assertDemandSignalsHaveEvidence(signals: readonly DemandSignal[]): string[] {
  const problems: string[] = [];
  for (const s of signals) {
    if (!s.evidenceFactIds.length) {
      problems.push(`DemandSignal ${s.id} missing evidenceFactIds`);
    }
  }
  return problems;
}
