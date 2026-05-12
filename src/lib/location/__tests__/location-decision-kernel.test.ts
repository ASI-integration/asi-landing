import { describe, expect, it } from 'vitest';
import { buildAnalysis } from '../gravity-scoring';
import type { OSMElement } from '../types';
import { attachLocationDecisionToAnalysis, buildLocationDecision } from '../location-decision-kernel';
import {
  enrichAnalysisWithReportProjection,
} from '../location-scoring-projection';
import {
  inferStreetHouseSubjectType,
  hasTouristAnchorCluster,
  magnetRoleFromCategory,
  isStrongPublicEvidenceMagnetFact,
} from '../location-decision-rules';
import { computeResidentialDemoPresentation } from '../rules/residential-location-rules';
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
      node(2, 0.0045, 0.00455, { amenity: 'theatre', name: 'Театр' }),
      node(3, 0.0042, 0.00425, { amenity: 'cinema', name: 'Кинотеатр' }),
    ];
    const a2 = buildAnalysis(clustered, ORIGIN.lat, ORIGIN.lon);
    const att = a2.magnets.find(m => m.categoryId === 'attraction');
    expect(att).toBeDefined();
    expect(hasTouristAnchorCluster(a2.magnets)).toBe(true);
    expect(magnetRoleFromCategory(att!, a2.magnets).role).toBe('tourist_demand');
  });

  it('metro museum stays local_interest with cluster (taxonomy weak attraction)', () => {
    const els: OSMElement[] = [
      node(1, 0.004, 0.004, { tourism: 'museum', name: 'Музей метро' }),
      node(2, 0.0045, 0.00455, { amenity: 'theatre', name: 'Театр' }),
      node(3, 0.0042, 0.00425, { amenity: 'cinema', name: 'Кино' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    expect(hasTouristAnchorCluster(analysis.magnets)).toBe(true);
    const mm = analysis.magnets.find(m => m.name.includes('Музей метро'));
    expect(mm).toBeDefined();
    expect(magnetRoleFromCategory(mm!, analysis.magnets).role).toBe('local_interest');
  });

  it('named cafe is not strong public kernel evidence (food excluded from score)', () => {
    const els: OSMElement[] = [
      node(1, 0.001, 0.001, { amenity: 'cafe', name: 'Кафе Фикстура' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const d = buildLocationDecision({
      analysis,
      inputAddress: '',
      coordinates: ORIGIN,
      locale: 'ru',
    });
    expect(d.evidenceItems.some(e => e.objectName.includes('Кафе'))).toBe(false);
    const cafeFact = d.magnetFacts.find(m => m.name.includes('Кафе'));
    expect(cafeFact).toBeDefined();
    expect(cafeFact!.includedInScore).toBe(false);
  });

  it('generic metro label renders as accessibility station wording', () => {
    const els: OSMElement[] = [
      node(1, 0.002, 0.001, { railway: 'subway', station: 'subway' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const d = buildLocationDecision({
      analysis,
      inputAddress: '',
      coordinates: ORIGIN,
      locale: 'ru',
    });
    const bullets = d.uiProjection.keyEvidenceBullets.join('\n');
    expect(bullets).toMatch(/доступности/i);
    expect(bullets).not.toMatch(/туристическим\s+спросом/i);
    expect(bullets).toMatch(/Станция метро \(название не указано в открытых данных\)/);
  });

  it('kernel emits no tourist_demand demandSignals when only local-interest magnets exist', () => {
    const els: OSMElement[] = [
      node(1, 0.004, 0.004, { tourism: 'museum', name: 'Нишевый музей' }),
      node(2, 0.0045, 0.0046, { tourism: 'hotel', name: 'Grand Hotel', stars: '5' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const d = buildLocationDecision({
      analysis,
      inputAddress: '',
      coordinates: ORIGIN,
      locale: 'ru',
    });
    expect(d.demandSignals.every(s => !s.internalReason.startsWith('tourist_demand'))).toBe(true);
  });

  it('public evidence prefers tier‑eligible magnets over weak local POI when both exist', () => {
    const els: OSMElement[] = [
      node(1, 0.004, 0.004, { tourism: 'museum', name: 'Локальный музей' }),
      node(2, 0.002, 0.001, { railway: 'subway', station: 'subway', name: 'Станция Якорь' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const d = buildLocationDecision({
      analysis,
      inputAddress: '',
      coordinates: ORIGIN,
      locale: 'ru',
    });
    expect(d.evidenceItems.length).toBeGreaterThan(0);
    expect(d.evidenceItems[0].objectName).toContain('Станция Якорь');
    expect(d.magnetFacts.filter(isStrongPublicEvidenceMagnetFact).every(m => m.role !== 'local_interest')).toBe(true);
  });

  it('RU demo headline cannot be strong tourist from lone weak museums even at high headline score', () => {
    const els: OSMElement[] = [
      node(1, 0.004, 0.004, { tourism: 'museum', name: 'Локальный музей' }),
      node(2, 0.0042, 0.0043, { tourism: 'museum', name: 'Второй локальный музей' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    analysis.scoringTrace!.finalScore = 85;
    const { sanity } = computeResidentialDemoPresentation(analysis, 85);
    expect(sanity.verdictLabelRu).not.toContain('Сильная туристическая локация');
    expect(sanity.displayAudience).not.toBe('TOURIST');
  });

  it('kernel evidence bullets omit generic unnamed attraction placeholder label', () => {
    const els: OSMElement[] = [node(1, 0.004, 0.004, { tourism: 'museum' })];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const d = buildLocationDecision({
      analysis,
      inputAddress: '',
      coordinates: ORIGIN,
      locale: 'ru',
    });
    expect(d.uiProjection.keyEvidenceBullets.join('\n')).not.toContain('Достопримечательность');
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

  it('attach sync keeps custody: trace.finalScore matches LocationDecision.finalScore', () => {
    const els: OSMElement[] = [
      node(1, 0.002, 0.001, { railway: 'subway', station: 'subway', name: 'Метро А' }),
      node(2, 0.0035, 0.002, { university: 'yes', name: 'Университет Б' }),
    ];
    const analysis = buildAnalysis(els, ORIGIN.lat, ORIGIN.lon);
    const merged = attachLocationDecisionToAnalysis(analysis, {
      inputAddress: 'demo',
      coordinates: ORIGIN,
      locale: 'ru',
    });
    const d = merged.locationDecision;
    expect(d.finalScore).toBe(merged.scoringTrace?.finalScore ?? null);
    expect(publicLocationScore(merged)).toBe(d.finalScore);
    expect(d.uiProjection.publicScore).toBe(d.finalScore);
  });

  it('standalone buildLocationDecision may diverge from trace until attach sync', () => {
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
    expect(d.demandKernelV1).not.toBeNull();
    expect(Number.isFinite(d.finalScore ?? NaN)).toBe(true);
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
