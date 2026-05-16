import { describe, expect, it } from 'vitest';
import {
  buildFreeLocationReportViewModel,
  type FreeLocationReportViewModel,
} from '../free-report-renderer';
import type { LocationDecision } from '../location-decision-contract';
import { forbiddenFreeReportFields } from '../report-scope-contract';

function collectKeys(value: unknown, out = new Set<string>()): Set<string> {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    value.forEach(item => collectKeys(item, out));
    return out;
  }
  for (const [key, nested] of Object.entries(value)) {
    out.add(key);
    collectKeys(nested, out);
  }
  return out;
}

function decisionWithEvidence(total: number): LocationDecision {
  const evidenceItems = Array.from({ length: total }, (_, i) => ({
    evidenceId: `ev-${i}`,
    factId: `fact-${i}`,
    objectName: `Объект ${i + 1}`,
    typeRu: i % 2 === 0 ? 'транспорт' : 'медицина',
    distanceMeters: 120 + i * 80,
    publicExplanationRu: `подтверждает спрос ${i + 1}`,
  }));

  return {
    inputAddress: 'Санкт-Петербург, Невский проспект, 88',
    finalScore: 72,
    evidenceItems,
    publicClaims: [],
    publicSummary: {
      finalScore: 72,
      audienceVerdictRu: 'Локация подходит для предварительного рассмотрения.',
      publicDrivers: evidenceItems.map(item => ({
        textRu: `${item.objectName} рядом`,
        trace: {
          evidenceId: item.evidenceId,
          magnetFactId: item.factId,
          demandSignalId: null,
          eligibilityReason: 'confirmed_evidence',
        },
      })),
      recommendedStrategyBulletsRu: ['Сначала проверьте подробный отчёт по рискам и конкуренции.'],
    },
    uiProjection: { publicScore: 72, heroTitle: 'Публичный вывод' },
    debugTrace: ['must not leak'],
    scoreTrace: { finalScore: 72, debugTrace: ['must not leak'] },
    competitorDetails: [{ name: 'hidden' }],
    rawSources: [{ id: 'hidden-source' }],
  } as unknown as LocationDecision;
}

describe('buildFreeLocationReportViewModel', () => {
  it('returns max 5 evidence bullets', () => {
    const report = buildFreeLocationReportViewModel({
      decision: decisionWithEvidence(7),
    });

    expect(report.topEvidenceBullets).toHaveLength(5);
    expect(report.topEvidenceBullets.map(b => b.name)).toEqual([
      'Объект 1',
      'Объект 2',
      'Объект 3',
      'Объект 4',
      'Объект 5',
    ]);
    expect(report.structure.mode).toBe('free');
    expect(report.structure.sections.map(section => section.id)).toContain('topResultReasons');
  });

  it('never returns forbidden free-report fields', () => {
    const report: FreeLocationReportViewModel = buildFreeLocationReportViewModel({
      decision: decisionWithEvidence(3),
      analysis: {
        locationScore: { location_score: 99, internalWeights: { hidden: 1 } },
      } as never,
    });
    const keys = collectKeys(report);

    for (const field of forbiddenFreeReportFields) {
      expect(keys.has(field), `free report must not expose ${field}`).toBe(false);
    }
  });

  it('uses only named evidence with distance', () => {
    const decision = decisionWithEvidence(1);
    decision.evidenceItems = [
      ...decision.evidenceItems,
      {
        evidenceId: 'ev-no-name',
        factId: 'fact-no-name',
        objectName: '',
        typeRu: 'транспорт',
        distanceMeters: 300,
        publicExplanationRu: 'hidden',
      },
      {
        evidenceId: 'ev-no-distance',
        factId: 'fact-no-distance',
        objectName: 'Без дистанции',
        typeRu: 'транспорт',
        distanceMeters: Number.NaN,
        publicExplanationRu: 'hidden',
      },
    ];
    decision.publicSummary!.publicDrivers = decision.evidenceItems.map(item => ({
      textRu: item.objectName,
      trace: {
        evidenceId: item.evidenceId,
        magnetFactId: item.factId,
        demandSignalId: null,
        eligibilityReason: 'confirmed_evidence',
      },
    }));

    const report = buildFreeLocationReportViewModel({ decision });

    expect(report.topEvidenceBullets).toEqual([
      {
        name: 'Объект 1',
        category: 'транспорт',
        distanceMeters: 120,
        distanceLabel: '120 м',
        shortReason: 'подтверждает спрос 1',
      },
    ]);
  });

  it('uses canonical free report CTA and paid teaser copy', () => {
    const report = buildFreeLocationReportViewModel({
      decision: decisionWithEvidence(3),
    });

    expect(report.cta.primaryLabel).toBe('Получить подробный отчёт');
    expect(report.shortRecommendation).toBe(
      'Для решения по объекту проверьте экономику, конкурентов и сценарий запуска в подробном отчёте.',
    );
    expect(report.paidReportTeaser).toContain('коммерческий потенциал');
    expect(report.structure.paidPreviewSections?.map(section => section.id)).toContain('detailedMagnets');
  });
});
