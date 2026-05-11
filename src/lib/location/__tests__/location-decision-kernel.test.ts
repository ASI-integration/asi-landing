import { describe, expect, it } from 'vitest';
import { buildAnalysis } from '../gravity-scoring';
import type { OSMElement } from '../types';
import { buildLocationDecision } from '../location-decision-kernel';
import {
  enrichAnalysisWithReportProjection,
} from '../location-scoring-projection';
import {
  inferStreetHouseSubjectType,
  hasTouristAnchorCluster,
  magnetRoleFromCategory,
} from '../location-decision-rules';
import { publicLocationScore } from '../location-score-public';

const ORIGIN = { lat: 55.7522, lon: 37.6156 };

function node(id: number, dLat: number, dLon: number, tags: Record<string, string>): OSMElement {
  return { type: 'node', id, lat: ORIGIN.lat + dLat, lon: ORIGIN.lon + dLon, tags };
}

describe('Location Decision Kernel', () => {
  it('street + house keeps analysis subject address-minded (heuristic)', () => {
    expect(inferStreetHouseSubjectType('Санкт-Петербург, ул. Фрунзе, д. 6')).toBe('address');
    expect(buildLocationDecision({
      analysis: buildAnalysis([], ORIGIN.lat, ORIGIN.lon),
      inputAddress: 'ул. Ленина, 10',
      coordinates: ORIGIN,
      locale: 'ru',
      geocodeSubjectHint: 'poi',
    }).addressIdentity.subjectType).toBe('address');
  });

  it('same-address POI classification stays magnetFact, not addressIdentity subject flip', () => {
    const els: OSMElement[] = [
      node(1, 0.002, 0.001, { railway: 'subway', station: 'subway', name: 'Приморская' }),
      node(2, 0.0001, 0.0001, { tourism: 'museum', name: 'Музей рядом' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const decision = buildLocationDecision({
      analysis,
      inputAddress: 'ул. Одое́вского, 33',
      coordinates: ORIGIN,
      rawElements: els,
      locale: 'ru',
    });
    expect(decision.addressIdentity.subjectType).toBe('address');
    expect(decision.magnetFacts.some(m => m.name.includes('Музей'))).toBe(true);
  });

  it('metro maps to accessibility role, not transport_anchor', () => {
    const els: OSMElement[] = [
      node(1, 0.002, 0.001, { railway: 'subway', station: 'subway', name: 'Фикстура метро' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const mf = decisionMagnetNamed(analysis, 'Фикстура метро');
    expect(mf?.role).toBe('accessibility');
  });

  it('local museum stays local_interest without tourist anchor cluster', () => {
    const els: OSMElement[] = [
      node(1, 0.004, 0.004, { tourism: 'museum', name: 'Нишевый музей' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    expect(hasTouristAnchorCluster(analysis.magnets)).toBe(false);
    const mf = decisionMagnetNamed(analysis, 'Нишевый музей');
    expect(mf?.role).toBe('local_interest');
  });

  it('tourist demand appears only with tourist/event anchor cluster near attraction', () => {
    const loneAttraction: OSMElement[] = [
      node(1, 0.004, 0.004, { tourism: 'museum', name: 'Один музей' }),
    ];
    const a1 = buildAnalysis(loneAttraction, ORIGIN.lat, ORIGIN.lon);
    const magnet = a1.magnets.find(m => m.categoryId === 'attraction');
    expect(magnet).toBeDefined();
    expect(magnetRoleFromCategory(magnet!, a1.magnets).role).toBe('local_interest');

    const clustered: OSMElement[] = [
      node(1, 0.004, 0.004, { tourism: 'museum', name: 'Музей' }),
      node(2, 0.0045, 0.0046, { tourism: 'hotel', name: 'Grand Hotel', stars: '5' }),
      node(3, 0.0042, 0.0043, { amenity: 'theatre', name: 'Театр' }),
    ];
    const a2 = buildAnalysis(clustered, ORIGIN.lat, ORIGIN.lon);
    const att = a2.magnets.find(m => m.categoryId === 'attraction');
    expect(att).toBeDefined();
    expect(hasTouristAnchorCluster(a2.magnets)).toBe(true);
    expect(magnetRoleFromCategory(att!, a2.magnets).role).toBe('tourist_demand');
  });

  it('strong public bullets include name, type (category), and distance via kernel formatting', () => {
    const els: OSMElement[] = [
      node(1, 0.002, 0.001, { railway: 'subway', station: 'subway', name: 'Приморская' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const d = buildLocationDecision({
      analysis,
      inputAddress: 'test',
      coordinates: ORIGIN,
      rawElements: els,
      locale: 'ru',
    });
    for (const bullet of d.uiProjection.keyEvidenceBullets) {
      expect(bullet).toMatch(/около\s+\d/);
      expect(bullet).toMatch(/—/);
      expect(bullet.length).toBeGreaterThan(24);
    }
  });

  it('UI public score equals LocationDecision.finalScore and trace.finalScore', () => {
    const els: OSMElement[] = [
      node(1, 0.002, 0.001, { railway: 'subway', station: 'subway', name: 'Метро А' }),
      node(2, 0.0035, 0.002, { university: 'yes', name: 'Университет Б' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const d = buildLocationDecision({
      analysis,
      inputAddress: 'demo',
      coordinates: ORIGIN,
      locale: 'ru',
    });
    expect(d.finalScore).toBe(analysis.scoringTrace?.finalScore ?? null);
    expect(publicLocationScore(analysis)).toBe(d.finalScore);
    expect(d.uiProjection.publicScore).toBe(d.finalScore);
  });

  it('free and paid projections share finalScore; free prefers kernel bullets when present', () => {
    const els: OSMElement[] = [
      node(1, 0.002, 0.001, { railway: 'subway', station: 'subway', name: 'Metro K' }),
      node(2, 0.0035, 0.002, { university: 'yes', name: 'Uni L' }),
    ];
    const base = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const paid = enrichAnalysisWithReportProjection(base, { reportMode: 'paid' });
    const free = enrichAnalysisWithReportProjection(base, { reportMode: 'free', rawElements: els });
    expect(paid.scoringTrace!.finalScore).toBe(base.scoringTrace!.finalScore);
    expect(free.scoringTrace!.finalScore).toBe(base.scoringTrace!.finalScore);
    expect(free.scoringTrace!.publicBullets.length).toBeGreaterThan(0);
    expect(free.scoringTrace!.publicBullets[0]).toMatch(/около/);
  });

  it('cache-style analysis without raw OSM still yields magnet-derived canonical facts', () => {
    const els: OSMElement[] = [
      node(1, 0.002, 0.001, { railway: 'subway', station: 'subway', name: 'Парк Победы' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const d = buildLocationDecision({
      analysis,
      inputAddress: '',
      coordinates: ORIGIN,
      locale: 'ru',
    });
    expect(d.canonicalFacts.length).toBeGreaterThan(0);
    expect(d.canonicalFacts[0].source).toBe('derived_magnet');
  });
});

function decisionMagnetNamed(
  analysis: ReturnType<typeof buildAnalysis>,
  needle: string,
) {
  const d = buildLocationDecision({
    analysis,
    inputAddress: '',
    coordinates: ORIGIN,
    locale: 'ru',
  });
  return d.magnetFacts.find(m => m.name.includes(needle));
}
