/**
 * Strict raw OSM tag → magnet alignment for demand kernel v1.
 * Prevents nearest-neighbor category matches from poisoning unrelated magnets (e.g. shop + bus_station tags).
 */

import type { CanonicalLocationFact } from './location-decision-contract';
import type { MagnetItem, OSMElement } from './types';
import { haversineMeters } from './gravity-scoring';
import { classifyElement } from './overpass-classify';

export const TAG_ALIGNMENT_EXACT_ID = 'tag_alignment_exact_id';
export const TAG_ALIGNMENT_NAME_CATEGORY_MATCH = 'tag_alignment_name_category_match';
export const TAG_ALIGNMENT_REJECTED_NAME_MISMATCH = 'tag_alignment_rejected_name_mismatch';
export const TAG_ALIGNMENT_REJECTED_CATEGORY_MISMATCH = 'tag_alignment_rejected_category_mismatch';
export const TAG_ALIGNMENT_REJECTED_TOO_FAR = 'tag_alignment_rejected_too_far';

/** Same POI proxy — tags only when co-located */
const ALIGN_EXACT_M = 14;
/** Looser radius only when OSM / magnet names strongly agree */
const ALIGN_NAME_MATCH_MAX_M = 95;
/** Tight co-location + identical normalized name → exact-id style reason */
const ALIGN_EXACT_NAME_M = 10;

function normalizeNameToken(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function genericPlaceholderName(n: string): boolean {
  const t = normalizeNameToken(n);
  if (!t || t.length < 2) return true;
  return /^(магазин|shop|store|отель|hotel|офис|office|станция|station|транспорт|узел|остановка|больница|hospital|клиника)$/i.test(
    t,
  );
}

function significantTokens(n: string): string[] {
  return normalizeNameToken(n)
    .split(' ')
    .filter(x => x.length >= 3);
}

export function namesCompatibleForTagAlignment(
  magnetName: string,
  osmElementName: string | undefined,
  magnetCategoryId: string,
): boolean {
  const a = (magnetName ?? '').trim();
  const b = (osmElementName ?? '').trim();
  if (!a || !b) {
    return genericPlaceholderName(a) && genericPlaceholderName(b);
  }

  const na = normalizeNameToken(a);
  const nb = normalizeNameToken(b);
  if (!na || !nb) return false;

  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;

  const ta = significantTokens(a);
  const tb = significantTokens(b);
  if (ta.length === 0 || tb.length === 0) {
    return na.includes(nb) || nb.includes(na);
  }

  const setB = new Set(tb);
  for (const x of ta) {
    if (setB.has(x)) return true;
  }

  if (magnetCategoryId === 'metro' && (na.length >= 4 || nb.length >= 4)) {
    return na.slice(0, 4) === nb.slice(0, 4);
  }

  return false;
}

function rawTagsCoherentWithMagnetCategory(magnetCategoryId: string, tags: Record<string, string>): boolean {
  const t = tags;
  switch (magnetCategoryId) {
    case 'railway_station':
      return (
        t.amenity === 'bus_station' ||
        t.railway === 'station' ||
        t.railway === 'halt' ||
        t.amenity === 'ferry_terminal' ||
        t.waterway === 'dock' ||
        t.landuse === 'harbour' ||
        t.industrial === 'port' ||
        t.industrial === 'logistics' ||
        (t.harbour === 'yes' && Boolean(t.name?.trim()))
      );
    case 'metro':
      return t.railway === 'subway_entrance' || t.station === 'subway';
    case 'airport':
    case 'strategicTransportHub':
      return t.aeroway === 'aerodrome' || t.aeroway === 'terminal' || Boolean(t.iata);
    case 'hospital':
    case 'specializedMedicalAnchor':
      return (
        t.amenity === 'hospital' ||
        t.healthcare === 'hospital' ||
        (t.amenity === 'clinic' && Boolean(t.name?.trim())) ||
        t.healthcare === 'surgery'
      );
    case 'major_hotel':
    case 'mid_hotel':
      return t.tourism === 'hotel';
    case 'shopping_major':
      return t.shop === 'mall' || t.shop === 'department_store';
    case 'shopping_local':
      return Boolean(t.shop) && t.shop !== 'mall' && t.shop !== 'department_store';
    case 'business':
      return Boolean(t.office) || t.landuse === 'industrial' || t.man_made === 'works' || t.amenity === 'bank';
    case 'attraction':
    case 'entertainment':
      return (
        t.tourism === 'attraction' ||
        t.tourism === 'museum' ||
        t.tourism === 'gallery' ||
        t.historic === 'monument' ||
        t.amenity === 'cinema' ||
        t.amenity === 'theatre' ||
        t.amenity === 'arts_centre'
      );
    default:
      return true;
  }
}

function categoryMatchesMagnet(magnetCategoryId: string, classifiedCategoryId: string): boolean {
  return magnetCategoryId === classifiedCategoryId;
}

export interface OsmTagAlignmentCandidate {
  categoryId: string;
  lat: number;
  lon: number;
  tags: Record<string, string>;
  name: string;
  osmKey: string;
}

export function rawElementAlignmentCandidates(rawElements: readonly OSMElement[]): OsmTagAlignmentCandidate[] {
  const out: OsmTagAlignmentCandidate[] = [];
  for (const el of rawElements) {
    const cl = classifyElement(el);
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!cl || lat == null || lon == null) continue;
    out.push({
      categoryId: cl.categoryId,
      lat,
      lon,
      tags: el.tags ?? {},
      name: cl.name,
      osmKey: `${el.type}:${el.id}`,
    });
  }
  return out;
}

/**
 * Attach OSM tags to derived magnet canonical facts only when distance + name + tag coherence pass.
 */
export function attachOsmTagsToMagnetCanonicalFacts(args: {
  magnets: readonly MagnetItem[];
  baseFacts: readonly CanonicalLocationFact[];
  rawElements: readonly OSMElement[];
}): CanonicalLocationFact[] {
  const { magnets, baseFacts, rawElements } = args;
  if (!rawElements.length) return [...baseFacts];

  const candidates = rawElementAlignmentCandidates(rawElements);

  return baseFacts.map((cf, idx) => {
    const m = magnets[idx];
    if (!m) return cf;

    const warnings = [...(cf.warnings ?? [])];

    type Best = { tags: Record<string, string>; dist: number; reason: string };
    let best: Best | null = null;

    for (const c of candidates) {
      if (!categoryMatchesMagnet(m.categoryId, c.categoryId)) continue;

      const d = haversineMeters(m.lat, m.lon, c.lat, c.lon);
      if (!Number.isFinite(d)) continue;

      const tags = c.tags;
      if (!rawTagsCoherentWithMagnetCategory(m.categoryId, tags)) continue;

      const osmDisplayName = tags.name?.trim() || c.name;

      let reason: string | null = null;

      if (d <= ALIGN_EXACT_M) {
        const nameOk =
          namesCompatibleForTagAlignment(m.name, osmDisplayName, m.categoryId) ||
          (genericPlaceholderName(m.name) && genericPlaceholderName(osmDisplayName));
        if (!nameOk) continue;
        const tightName =
          normalizeNameToken(m.name) === normalizeNameToken(osmDisplayName) && normalizeNameToken(m.name).length >= 3;
        reason = tightName && d <= ALIGN_EXACT_NAME_M ? TAG_ALIGNMENT_EXACT_ID : TAG_ALIGNMENT_NAME_CATEGORY_MATCH;
      } else if (d <= ALIGN_NAME_MATCH_MAX_M) {
        if (!namesCompatibleForTagAlignment(m.name, osmDisplayName, m.categoryId)) continue;
        reason = TAG_ALIGNMENT_NAME_CATEGORY_MATCH;
      } else {
        continue;
      }

      if (!best || d < best.dist) {
        best = { tags, dist: d, reason };
      }
    }

    if (best) {
      warnings.push(best.reason);
      return {
        ...cf,
        rawTags: best.tags,
        warnings,
      };
    }

    let rejectReason = TAG_ALIGNMENT_REJECTED_CATEGORY_MISMATCH;
    let nearestProblemD = Infinity;
    for (const c of candidates) {
      if (!categoryMatchesMagnet(m.categoryId, c.categoryId)) continue;
      const d = haversineMeters(m.lat, m.lon, c.lat, c.lon);
      if (!Number.isFinite(d) || d > nearestProblemD) continue;

      const tags = c.tags;
      const osmDisplayName = tags.name?.trim() || c.name;

      if (!rawTagsCoherentWithMagnetCategory(m.categoryId, tags)) {
        nearestProblemD = d;
        rejectReason = TAG_ALIGNMENT_REJECTED_CATEGORY_MISMATCH;
        continue;
      }
      if (d > ALIGN_NAME_MATCH_MAX_M) {
        nearestProblemD = d;
        rejectReason = TAG_ALIGNMENT_REJECTED_TOO_FAR;
        continue;
      }
      if (d > ALIGN_EXACT_M && !namesCompatibleForTagAlignment(m.name, osmDisplayName, m.categoryId)) {
        nearestProblemD = d;
        rejectReason = TAG_ALIGNMENT_REJECTED_NAME_MISMATCH;
        continue;
      }
      if (d <= ALIGN_EXACT_M && !namesCompatibleForTagAlignment(m.name, osmDisplayName, m.categoryId)) {
        if (!(genericPlaceholderName(m.name) && genericPlaceholderName(osmDisplayName))) {
          nearestProblemD = d;
          rejectReason = TAG_ALIGNMENT_REJECTED_NAME_MISMATCH;
        }
      }
    }

    if (nearestProblemD < Infinity) {
      warnings.push(rejectReason);
    }

    return { ...cf, rawTags: undefined, warnings };
  });
}
