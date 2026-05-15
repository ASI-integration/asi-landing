import { describe, expect, it } from 'vitest';
import type { LocationDecision, LocationEvidenceItem } from '../location-decision-contract';
import {
  buildRuResidentialPublicEvidenceLines,
  resolveRuResidentialDemandHeadlineRu,
  ruResidentialDemandSignalsIncludeTouristEvidence,
  RU_RESIDENTIAL_NEUTRAL_EVIDENCE_LINE_RU,
  formatRuResidentialEvidenceRowRu,
} from '../ru-residential-ui-projection';

function stubDecision(partial: Partial<LocationDecision> & Pick<LocationDecision, 'demandSignals'>): LocationDecision {
  return {
    inputAddress: '',
    addressIdentity: {
      subjectType: 'ambiguous',
      selectedAddressPoint: { lat: 0, lon: 0 },
      selectedPoiAtSameAddress: [],
      warnings: [],
    },
    coordinates: { lat: 0, lon: 0 },
    dataIntegrity: { integrityReasons: [] },
    rawObjectStats: { rawObjectsCount: 0, classifiedMagnetCount: 0, competitorCount: 0 },
    canonicalFacts: [],
    magnetFacts: [],
    evidenceItems: [],
    publicReportSections: [],
    scoreTrace: null,
    finalScore: 50,
    scoreBand: 'medium',
    uiProjection: {
      publicScore: 50,
      scoreBand: 'medium',
      heroTitle: '',
      keyEvidenceBullets: [],
      environmentSummary: '',
      strategySummary: '',
      warnings: [],
    },
    warnings: [],
    ...partial,
  } as LocationDecision;
}

describe('ru-residential-ui-projection', () => {
  const forbiddenRuLegacySnippets = [
    'Основной поток: TOURIST',
    'Сильные сигналы спроса в зоне',
    'Есть туристические или досуговые объекты',
    'Есть крупные транспортные узлы',
    'Крупный транспортный узел в транспортной доступности.',
  ];

  it('public evidence lines never include legacy generic score-factor phrases', () => {
    const item: LocationEvidenceItem = {
      evidenceId: 'ev:0:business:100',
      factId: 'mf:0:business:100',
      objectName: 'БЦ Пример',
      typeRu: 'Бизнес-центр',
      subtypeRu: undefined,
      distanceMeters: 240,
      publicExplanationRu: 'legacy prose — ignored by formatter',
    };
    const d = stubDecision({
      demandSignals: [
        {
          id: 'ds:x',
          type: 'business_demand_Бизнес-центр',
          strength: 'strong',
          evidenceFactIds: [item.factId],
          reason: '',
          publicLabelRu: '',
          internalReason: '',
        },
      ],
      evidenceItems: [item],
      uiProjection: {
        publicScore: 50,
        scoreBand: 'medium',
        heroTitle: '',
        keyEvidenceBullets: ['should not surface verbatim'],
        environmentSummary: '',
        strategySummary: '',
        warnings: [],
      },
    });
    const lines = buildRuResidentialPublicEvidenceLines(d, 5);
    expect(lines[0]).toBe(formatRuResidentialEvidenceRowRu(item));
    expect(lines.join('\n')).not.toMatch(/should not surface verbatim/);
    for (const bad of forbiddenRuLegacySnippets) {
      expect(lines.join('\n')).not.toContain(bad);
    }
  });

  it('uses neutral copy when kernel produced no usable evidence rows', () => {
    const d = stubDecision({
      demandSignals: [],
      evidenceItems: [],
      uiProjection: {
        publicScore: 40,
        scoreBand: 'weak',
        heroTitle: '',
        keyEvidenceBullets: [],
        environmentSummary: '',
        strategySummary: '',
        warnings: [],
      },
    });
    expect(buildRuResidentialPublicEvidenceLines(d)).toEqual([RU_RESIDENTIAL_NEUTRAL_EVIDENCE_LINE_RU]);
  });

  it('tourist headline appears only when tourist_demand signals carry evidenceFactIds', () => {
    const bizOnly = stubDecision({
      demandSignals: [
        {
          id: 'ds:b',
          type: 'business_demand_X',
          strength: 'moderate',
          evidenceFactIds: ['mf:1'],
          reason: '',
          publicLabelRu: '',
          internalReason: '',
        },
      ],
    });
    expect(resolveRuResidentialDemandHeadlineRu(bizOnly)).toBe('Спрос от делового и офисного трафика');
    expect(ruResidentialDemandSignalsIncludeTouristEvidence(bizOnly)).toBe(false);

    const touristBacked = stubDecision({
      demandSignals: [
        {
          id: 'ds:t',
          type: 'tourist_demand_Отель',
          strength: 'strong',
          evidenceFactIds: ['mf:2'],
          reason: '',
          publicLabelRu: '',
          internalReason: '',
        },
      ],
    });
    expect(resolveRuResidentialDemandHeadlineRu(touristBacked)).toBe('Туристический спрос в зоне');
    expect(ruResidentialDemandSignalsIncludeTouristEvidence(touristBacked)).toBe(true);

    const touristWithoutEvidence = stubDecision({
      demandSignals: [
        {
          id: 'ds:t2',
          type: 'tourist_demand_Отель',
          strength: 'strong',
          evidenceFactIds: [],
          reason: '',
          publicLabelRu: '',
          internalReason: '',
        },
      ],
    });
    expect(resolveRuResidentialDemandHeadlineRu(touristWithoutEvidence)).not.toBe('Туристический спрос в зоне');
    expect(ruResidentialDemandSignalsIncludeTouristEvidence(touristWithoutEvidence)).toBe(false);
  });

  it('LocationIntelligenceDemo ASIPanel derives RU residential bullets from the free report view model', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const demoPath = fileURLToPath(new URL('../../../components/LocationIntelligenceDemo.tsx', import.meta.url));
    const src = readFileSync(demoPath, 'utf8');
    expect(src).toContain("from '@/lib/location/free-report-renderer'");
    expect(src).toContain('buildFreeLocationReportViewModel({');
    expect(src).toContain('const freeEvidenceLines = (freeReport?.topEvidenceBullets ?? []).map(formatFreeEvidenceLine);');
    expect(src).toContain('if (dataBlocked) return [];');
    expect(src).toContain('return (freeReport?.topEvidenceBullets ?? []).slice(0, 2).map(formatFreeEvidenceLine);');
    expect(src).toContain('const mergedClaims = freeEvidenceLines.slice(0, 5);');
    expect(src).toContain('isRuResidentialDemo && !dataBlocked');
    expect(src).not.toContain('const residentialUiClaims');
    expect(src).not.toContain('publicDrivers ?? []).map');
    expect(src).not.toContain('residentialPublicSummary?.headlineRu');
    expect(src).not.toContain('normalizeRuDemoExplanationLines');
    expect(src).not.toContain('buildRuResidentialPublicEvidenceLines');
    expect(src).not.toContain('analysis.locationScore.factors');
  });
});
