import { describe, expect, it } from 'vitest';
import type { MagnetItem, OSMElement } from '../types';
import { buildAnalysis } from '../gravity-scoring';
import { attachOsmTagsToMagnetCanonicalFacts, TAG_ALIGNMENT_REJECTED_NAME_MISMATCH } from '../kernel-osm-tag-alignment';
import { buildLocationDecision } from '../location-decision-kernel';
import { canonicalFactsFromMagnetsFallback, magnetItemToMagnetFact } from '../location-decision-rules';
import { publicDemandProfileHeadline } from '../location-public-claims';
import { runLocationDemandScoringKernel } from '../location-scoring-kernel';

const ORIGIN = { lat: 55.042, lon: 82.921 }; // inland RU-style coords — avoids coastal projection quirks

function node(id: number, dLat: number, dLon: number, tags: Record<string, string>): OSMElement {
  return { type: 'node', id, lat: ORIGIN.lat + dLat, lon: ORIGIN.lon + dLon, tags };
}

function minimalMagnet(
  m: Pick<MagnetItem, 'categoryId' | 'name' | 'lat' | 'lon' | 'distance'> & Partial<MagnetItem>,
): MagnetItem {
  return {
    categoryLabel: m.categoryLabel ?? m.categoryId,
    icon: '·',
    weight: 4,
    permanenceType: 'permanent',
    scopeLevel: 'district',
    strengthClass: 'medium',
    attractionScore: 3,
    ...m,
  };
}

describe('POI tag alignment + public display regression (live screenshot scenarios)', () => {
  it('A Kemerovo-style: shop magnet must not inherit bus_station OSM tags (name/category coherence)', () => {
    const lat = ORIGIN.lat + 0.0004;
    const lon = ORIGIN.lon + 0.00035;
    const magnets: MagnetItem[] = [
      minimalMagnet({
        categoryId: 'railway_station',
        name: 'Магазин Аннота',
        lat,
        lon,
        distance: 95,
      }),
    ];
    const raw: OSMElement[] = [
      {
        type: 'node',
        id: 901,
        lat: lat + 0.00002,
        lon: lon + 0.00002,
        tags: { amenity: 'bus_station', name: 'Автостанция Южная' },
      },
    ];

    const base = canonicalFactsFromMagnetsFallback(magnets);
    const merged = attachOsmTagsToMagnetCanonicalFacts({ magnets, baseFacts: base, rawElements: raw });
    expect(merged[0]?.rawTags).toBeUndefined();
    expect(merged[0]?.warnings.some(w => w.includes('tag_alignment_rejected'))).toBe(true);

    const magnetFacts = magnets.map((mag, idx) => magnetItemToMagnetFact(mag, idx, magnets));

    const kernel = runLocationDemandScoringKernel({
      magnets,
      magnetFacts,
      canonicalFacts: merged,
      engineFinalScore: 58,
    });

    expect(kernel.scoredDrivers[0]?.tagAlignmentStatus).toMatch(/tag_alignment_rejected|tag_alignment_none/);
    expect(kernel.scoredDrivers[0]?.tagAlignmentStatus).not.toBe('tag_alignment_name_category_match');

    const explanation = magnetFacts[0]!.explanationRu;
    expect(explanation).not.toMatch(/bus_station/i);
  });

  it('B Krasnoyarsk-style: hospitals dominate — no tourism headline; hotels/offices not in public bullets', () => {
    const els: OSMElement[] = [
      node(1, 0.0028, 0.0026, { amenity: 'hospital', name: 'Краевая клиническая больница' }),
      node(2, 0.0031, 0.0029, { amenity: 'hospital', name: 'Детская областная больница' }),
      node(3, 0.002, 0.0024, { tourism: 'hotel', name: 'Сибирия Отель', stars: '4' }),
      node(4, 0.0024, 0.0023, { office: 'yes', name: 'Офис Рога и Копыта' }),
      node(5, 0.0035, 0.0036, { shop: 'mall', name: 'ТРЦ Север' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const decision = buildLocationDecision({
      analysis,
      inputAddress: 'fixture',
      coordinates: ORIGIN,
      rawElements: els,
      locale: 'ru',
    });

    expect(publicDemandProfileHeadline(decision, 'ru')).not.toMatch(/туристическ/i);
    expect(decision.demandKernelV1?.dominantDemandType).not.toBe('tourist');

    expect(decision.publicClaims.every(c => !/Отель|Гостиниц|hotel/i.test(c.textRu))).toBe(true);
    expect(decision.publicClaims.every(c => !/Офис\s+Рога/i.test(c.textRu))).toBe(true);

    const top = decision.evidenceItems[0]?.objectName ?? '';
    expect(/больниц|клиническ|детск/i.test(top)).toBe(true);

    const hotelDriver = decision.demandKernelV1?.scoredDrivers.find(d => /Сибирия/i.test(d.sourceName));
    expect(hotelDriver?.publicDisplayEligible).toBe(false);
  });

  it('C generic offices/retail/hotels may be accepted internally but not promoted to public bullets', () => {
    const els: OSMElement[] = [
      node(1, 0.0015, 0.0014, { tourism: 'hotel', name: 'Three Star Inn', stars: '3' }),
      node(2, 0.0018, 0.0017, { office: 'yes', name: 'Офис' }),
      node(3, 0.002, 0.0019, { shop: 'convenience', name: 'Пятёрочка Угол' }),
      node(4, 0.004, 0.0041, { amenity: 'hospital', name: 'Городская больница № 9' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const decision = buildLocationDecision({
      analysis,
      inputAddress: 'fixture',
      coordinates: ORIGIN,
      rawElements: els,
      locale: 'ru',
    });

    const acceptedHotel = decision.demandKernelV1?.acceptedDrivers.some(d => /Three Star|Инн/i.test(d.sourceName));
    const anyHotelShown = decision.publicClaims.some(c => /Three Star|Инн/i.test(c.textRu));
    expect(anyHotelShown).toBe(false);

    const officeShown = decision.publicClaims.some(c => /^\s*Офис\s+—/i.test(c.textRu) || c.textRu.includes('Офис — около'));
    expect(officeShown).toBe(false);

    // Current public contract: weak/generic medical evidence may stay internal-only.
    expect(decision.publicClaims.length).toBe(0);
    expect(decision.publicSummary?.publicDrivers.length ?? 0).toBe(0);
    const medicalDrivers = decision.demandKernelV1?.scoredDrivers.filter(d => d.demandTypeVote === 'medical') ?? [];
    expect(medicalDrivers.length).toBeGreaterThan(0);
    expect(medicalDrivers.some(d => d.accepted)).toBe(true);
    expect(medicalDrivers.every(d => d.publicDisplayEligible === false)).toBe(true);

    if (acceptedHotel) {
      const h = decision.demandKernelV1?.scoredDrivers.find(d => /Three Star/i.test(d.sourceName));
      expect(h?.publicDisplayEligible).toBe(false);
    }
  });

  it('name mismatch rejection reason is surfaced when category matches but POI differs', () => {
    const magnets: MagnetItem[] = [
      minimalMagnet({
        categoryId: 'railway_station',
        name: 'Магазин Аннота',
        lat: ORIGIN.lat,
        lon: ORIGIN.lon,
        distance: 40,
      }),
    ];
    const raw: OSMElement[] = [
      {
        type: 'node',
        id: 902,
        lat: ORIGIN.lat + 0.00001,
        lon: ORIGIN.lon + 0.00001,
        tags: { amenity: 'bus_station', name: 'Центральный автовокзал' },
      },
    ];
    const merged = attachOsmTagsToMagnetCanonicalFacts({
      magnets,
      baseFacts: canonicalFactsFromMagnetsFallback(magnets),
      rawElements: raw,
    });
    expect(merged[0]?.warnings).toContain(TAG_ALIGNMENT_REJECTED_NAME_MISMATCH);
  });
});
