import { describe, expect, it } from 'vitest';
import type { OSMElement } from '../types';
import type { LocationPublicSummary } from '../location-decision-contract';
import bundle from '../__fixtures__/golden-addresses.json';
import { buildAnalysis } from '../gravity-scoring';
import { enrichAnalysisWithReportProjection } from '../location-scoring-projection';
import { buildLocationDecision } from '../location-decision-kernel';

type GoldenCityKey = 'yalta' | 'rostov' | 'kemerovo' | 'novosibirsk' | 'saransk' | 'lodeynoye_pole';

interface GoldenCase {
  id: string;
  cityKey: GoldenCityKey;
  addressRu: string;
  replay: { lat: number; lon: number; elements: OSMElement[] };
}

function assertCases(x: unknown): asserts x is { cases: GoldenCase[] } {
  if (!x || typeof x !== 'object' || !('cases' in x) || !Array.isArray((x as { cases: unknown }).cases)) {
    throw new Error('golden-addresses.json: invalid shape');
  }
}

function publicSummaryFromReplay(c: GoldenCase): LocationPublicSummary {
  const { lat, lon, elements } = c.replay;
  const analysis = buildAnalysis(elements, lat, lon, {
    spatialFoundation: false,
    inputAddress: c.addressRu,
  });
  const projected = enrichAnalysisWithReportProjection(analysis, {
    reportMode: 'free',
    rawElements: elements,
  });
  const trace = projected.scoringTrace;
  if (!trace?.coordinates) {
    throw new Error(`missing scoringTrace.coordinates for case ${c.id}`);
  }
  const decision = buildLocationDecision({
    analysis: projected,
    inputAddress: c.addressRu,
    coordinates: trace.coordinates,
    rawElements: elements,
    selectedGeocodeResult: c.addressRu,
    locale: 'ru',
  });
  const ps = decision.publicSummary;
  if (!ps) {
    throw new Error(`null publicSummary for case ${c.id}`);
  }
  return ps;
}

describe('location golden assertions (LocationPublicSummary)', () => {
  assertCases(bundle);
  const byCity = new Map<GoldenCityKey, GoldenCase>();
  for (const c of bundle.cases) {
    byCity.set(c.cityKey, c);
  }

  const required: GoldenCityKey[] = [
    'yalta',
    'rostov',
    'kemerovo',
    'novosibirsk',
    'saransk',
    'lodeynoye_pole',
  ];
  for (const k of required) {
    if (!byCity.has(k)) {
      throw new Error(`golden-addresses.json: missing cityKey ${k}`);
    }
  }

  it('Yalta: verified tourist anchors → tourist-primary public headline; hotels stay off public driver lines', () => {
    const s = publicSummaryFromReplay(byCity.get('yalta')!);
    expect(s.primaryDemandType).toBe('tourist');
    expect(s.headlineRu).toMatch(/туристическ|событийн/i);
    expect(s.publicDrivers.every(d => !/отель|hotel|инн/i.test(d.textRu))).toBe(true);
  });

  it('Rostov: medical/mixed dominance — not a tourist-primary surface; no junk drivers', () => {
    const s = publicSummaryFromReplay(byCity.get('rostov')!);
    expect(s.primaryDemandType).not.toBe('tourist');
    expect(s.headlineRu).not.toMatch(/туристическ/i);
    expect(s.publicDrivers.every(d => !/отель|hotel|инн|кадров|агентств/i.test(d.textRu))).toBe(true);
    if (s.primaryDemandType === 'medical' || s.primaryDemandType === 'mixed') {
      expect(s.audienceVerdictRu).not.toMatch(/туристическ/i);
    }
  });

  it('Kemerovo: industrial / business-led kernel primary (not medical headline)', () => {
    const s = publicSummaryFromReplay(byCity.get('kemerovo')!);
    expect(['industrial', 'corporate/business', 'mixed'] as const).toContainEqual(s.primaryDemandType);
    expect(s.headlineRu).not.toMatch(/медицинск/i);
  });

  it('Novosibirsk: education anchor should win primary or headline', () => {
    const s = publicSummaryFromReplay(byCity.get('novosibirsk')!);
    const eduSecondary = s.secondaryDemandTypes.includes('education');
    expect(s.primaryDemandType === 'education' || eduSecondary).toBe(true);
    expect(s.headlineRu).toMatch(/образован|делов/i);
  });

  it('Saransk: metro + stadium → tourist or transport (map-backed anchors), not weak/unclear-only', () => {
    const s = publicSummaryFromReplay(byCity.get('saransk')!);
    expect(['tourist', 'transport', 'mixed'] as const).toContainEqual(s.primaryDemandType);
    expect(s.primaryDemandType).not.toBe('weak/unclear');
  });

  it('Lodeynoye Pole: sparse retail — cautious / weak public profile', () => {
    const s = publicSummaryFromReplay(byCity.get('lodeynoye_pole')!);
    expect(['weak/unclear', 'mixed'] as const).toContainEqual(s.primaryDemandType);
    expect(
      /ограничен|неустойчив|неоднознач|недостаточн/i.test(s.headlineRu) ||
        s.trace.headlineReason === 'no_strict_public_drivers_after_surface_gates',
    ).toBe(true);
  });
});
