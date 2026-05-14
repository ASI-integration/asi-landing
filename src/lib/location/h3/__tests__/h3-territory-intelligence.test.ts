import { describe, expect, it } from 'vitest';
import type { MagnetItem } from '../../types';
import {
  buildH3MagnetDensitySummary,
  buildH3TerritoryIntelligence,
  buildH3TerritoryIntelligenceForAnalysis,
} from '../';

const ORIGIN = { lat: 55.7522, lon: 37.6156 };

function magnet(
  partial: Partial<MagnetItem> & Pick<MagnetItem, 'categoryId' | 'name'>,
): MagnetItem {
  return {
    categoryLabel: partial.categoryId,
    icon: '+',
    lat: ORIGIN.lat,
    lon: ORIGIN.lon,
    distance: 120,
    weight: 5,
    permanenceType: 'permanent',
    scopeLevel: 'district',
    strengthClass: 'medium',
    attractionScore: 4,
    ...partial,
  };
}

function territoryFixture(
  magnets: MagnetItem[],
  emptyCoverageCellCount: number,
) {
  const summary = buildH3MagnetDensitySummary({
    origin: ORIGIN,
    magnets,
    options: { resolution: 9 },
  });

  return buildH3TerritoryIntelligence({
    summary,
    options: {
      coverageCells: [
        ...summary.cells.map(cell => cell.cell),
        ...Array.from({ length: emptyCoverageCellCount }, (_, index) => `fixture-empty-${index}`),
      ],
    },
  });
}

describe('H3 territory intelligence', () => {
  it('calculates normalized category diversity and transport dominance', () => {
    const territory = buildH3TerritoryIntelligenceForAnalysis({
      analysis: {
        magnets: [
          magnet({ name: 'Office A', categoryId: 'business' }),
          magnet({ name: 'Office B', categoryId: 'business', lat: ORIGIN.lat + 0.001 }),
          magnet({ name: 'Metro A', categoryId: 'metro' }),
          magnet({ name: 'Hotel A', categoryId: 'major_hotel' }),
          magnet({ name: 'University A', categoryId: 'university' }),
        ],
      },
      lat: ORIGIN.lat,
      lon: ORIGIN.lon,
      options: {
        coverageCells: ['cell-a', 'cell-b', 'cell-c', 'cell-d'],
      },
    });

    expect(territory.countedMagnets).toBe(5);
    expect(territory.categoryDiversityScore).toBeGreaterThan(0.75);
    expect(territory.categoryShares.business).toBe(0.4);
    expect(territory.transportDominanceRatio).toBe(0.2);
    expect(territory.comparisonVector.categoryDiversityScore).toBe(territory.categoryDiversityScore);
  });

  it('detects mono-functional territory without changing magnet taxonomy', () => {
    const territory = buildH3TerritoryIntelligenceForAnalysis({
      analysis: {
        magnets: [
          magnet({ name: 'Metro A', categoryId: 'metro' }),
          magnet({ name: 'Metro B', categoryId: 'railway_station', lat: ORIGIN.lat + 0.001 }),
          magnet({ name: 'Airport Link', categoryId: 'strategicTransportHub', lon: ORIGIN.lon + 0.001 }),
          magnet({ name: 'Office A', categoryId: 'business', lat: ORIGIN.lat + 0.002 }),
        ],
      },
      lat: ORIGIN.lat,
      lon: ORIGIN.lon,
      options: {
        coverageCells: ['cell-a', 'cell-b', 'cell-c'],
      },
    });

    expect(territory.functionality).toBe('mono_functional');
    expect(territory.monoFunctional.detected).toBe(true);
    expect(territory.monoFunctional.category).toBe('transport');
    expect(territory.transportDominanceRatio).toBe(0.75);
    expect(territory.businessTravelerSuitability.transportOverDominated).toBe(true);
  });

  it('identifies dead zones and low-density gaps from territory coverage', () => {
    const summary = buildH3MagnetDensitySummary({
      origin: ORIGIN,
      magnets: [
        magnet({ name: 'Office A', categoryId: 'business' }),
        magnet({ name: 'Metro A', categoryId: 'metro', lat: ORIGIN.lat + 0.01 }),
      ],
      options: { resolution: 9 },
    });
    const occupiedCells = summary.cells.map(cell => cell.cell);
    const territory = buildH3TerritoryIntelligence({
      summary,
      options: {
        coverageCells: [...occupiedCells, 'empty-cell-a', 'empty-cell-b'],
        lowDensityCellThreshold: 1,
      },
    });

    expect(territory.deadZones.coverageCellCount).toBe(4);
    expect(territory.deadZones.emptyCellCount).toBe(2);
    expect(territory.deadZones.lowDensityCellCount).toBe(2);
    expect(territory.deadZones.gapRatio).toBe(0.5);
    expect(territory.comparisonVector.deadZoneRatio).toBe(territory.deadZones.gapRatio);
  });

  it('keeps healthy mixed territory neutral even when radius coverage has empty cells', () => {
    const summary = buildH3MagnetDensitySummary({
      origin: ORIGIN,
      magnets: [
        magnet({ name: 'Office A', categoryId: 'business' }),
        magnet({ name: 'Office B', categoryId: 'convention', lat: ORIGIN.lat + 0.001 }),
        magnet({ name: 'Metro A', categoryId: 'metro', lon: ORIGIN.lon + 0.001 }),
        magnet({ name: 'Hotel A', categoryId: 'major_hotel', lat: ORIGIN.lat + 0.002 }),
        magnet({ name: 'University A', categoryId: 'university', lon: ORIGIN.lon + 0.002 }),
        magnet({ name: 'Museum A', categoryId: 'attraction', lat: ORIGIN.lat - 0.001 }),
      ],
      options: { resolution: 9 },
    });
    const occupiedCells = summary.cells.map(cell => cell.cell);
    const territory = buildH3TerritoryIntelligence({
      summary,
      options: {
        coverageCells: [
          ...occupiedCells,
          'empty-cell-a',
          'empty-cell-b',
          'empty-cell-c',
          'empty-cell-d',
          'empty-cell-e',
          'empty-cell-f',
        ],
      },
    });

    expect(territory.categoryDiversityScore).toBeGreaterThanOrEqual(0.67);
    expect(territory.deadZones.emptyCellRatio).toBeGreaterThan(0.45);
    expect(territory.deadZones.gapRatio).toBeLessThanOrEqual(0.22);
  });

  it('treats no territorial evidence as unknown instead of dead-zone', () => {
    const summary = buildH3MagnetDensitySummary({
      origin: ORIGIN,
      magnets: [],
      options: { resolution: 9 },
    });
    const territory = buildH3TerritoryIntelligence({
      summary,
      origin: ORIGIN,
    });

    expect(territory.countedMagnets).toBe(0);
    expect(territory.functionality).toBe('low_signal');
    expect(territory.deadZones.emptyCellRatio).toBeGreaterThan(0);
    expect(territory.deadZones.gapRatio).toBe(0);
  });

  it('calibrates deterministic dead-zone fixtures without live Overpass', () => {
    const noEvidence = territoryFixture([], 8);
    const denseMixedDiverse = territoryFixture([
      magnet({ name: 'Office A', categoryId: 'business' }),
      magnet({ name: 'Office B', categoryId: 'convention' }),
      magnet({ name: 'Metro A', categoryId: 'metro' }),
      magnet({ name: 'Rail A', categoryId: 'railway_station' }),
      magnet({ name: 'Hotel A', categoryId: 'major_hotel' }),
      magnet({ name: 'Museum A', categoryId: 'attraction' }),
      magnet({ name: 'University A', categoryId: 'university' }),
      magnet({ name: 'Hospital A', categoryId: 'hospital' }),
    ], 10);
    const businessSuitableDiverse = territoryFixture([
      magnet({ name: 'Office A', categoryId: 'business' }),
      magnet({ name: 'Office B', categoryId: 'business' }),
      magnet({ name: 'Office C', categoryId: 'convention' }),
      magnet({ name: 'Office D', categoryId: 'convention' }),
      magnet({ name: 'Metro A', categoryId: 'metro' }),
      magnet({ name: 'Rail A', categoryId: 'railway_station' }),
      magnet({ name: 'Hotel A', categoryId: 'major_hotel' }),
      magnet({ name: 'University A', categoryId: 'university' }),
    ], 10);
    const transportDiverse = territoryFixture([
      magnet({ name: 'Office A', categoryId: 'business' }),
      magnet({ name: 'Office B', categoryId: 'convention' }),
      magnet({ name: 'Metro A', categoryId: 'metro' }),
      magnet({ name: 'Metro B', categoryId: 'railway_station' }),
      magnet({ name: 'Airport Link', categoryId: 'strategicTransportHub' }),
      magnet({ name: 'Hotel A', categoryId: 'major_hotel' }),
      magnet({ name: 'University A', categoryId: 'university' }),
      magnet({ name: 'Hospital A', categoryId: 'hospital' }),
    ], 10);
    const levittownLikeSparseMonoFunctional = territoryFixture([
      magnet({ name: 'Strip Mall A', categoryId: 'shopping_major' }),
      magnet({ name: 'Strip Mall B', categoryId: 'shopping_major' }),
      magnet({ name: 'Strip Mall C', categoryId: 'shopping_major' }),
    ], 9);

    expect(noEvidence.deadZones.gapRatio).toBe(0);
    expect(denseMixedDiverse.deadZones.emptyCellRatio).toBeGreaterThan(0.8);
    expect(denseMixedDiverse.categoryDiversityScore).toBeGreaterThanOrEqual(0.67);
    expect(denseMixedDiverse.deadZones.gapRatio).toBeLessThanOrEqual(0.18);
    expect(businessSuitableDiverse.businessTravelerSuitability.score).toBeGreaterThanOrEqual(0.67);
    expect(businessSuitableDiverse.deadZones.gapRatio).toBeLessThanOrEqual(0.18);
    expect(transportDiverse.businessTravelerSuitability.hasTransportAccess).toBe(true);
    expect(transportDiverse.businessTravelerSuitability.businessTransportBalanceScore).toBeGreaterThanOrEqual(0.4);
    expect(transportDiverse.deadZones.gapRatio).toBeLessThanOrEqual(0.18);
    expect(levittownLikeSparseMonoFunctional.monoFunctional.detected).toBe(true);
    expect(levittownLikeSparseMonoFunctional.deadZones.gapRatio).toBeGreaterThanOrEqual(0.55);
  });

  it('exposes business-traveler suitability signals without touching score fields', () => {
    const analysis = {
      evergreenIndex: 71,
      magnets: [
        magnet({ name: 'Office A', categoryId: 'business' }),
        magnet({ name: 'Office B', categoryId: 'convention', lat: ORIGIN.lat + 0.001 }),
        magnet({ name: 'Metro A', categoryId: 'metro', lon: ORIGIN.lon + 0.001 }),
        magnet({ name: 'Hotel A', categoryId: 'major_hotel', lat: ORIGIN.lat + 0.002 }),
      ],
    };
    const beforeScore = analysis.evergreenIndex;

    const territory = buildH3TerritoryIntelligenceForAnalysis({
      analysis,
      lat: ORIGIN.lat,
      lon: ORIGIN.lon,
      options: {
        coverageCells: ['cell-a'],
      },
    });

    expect(territory.businessTravelerSuitability.hasBusinessCore).toBe(true);
    expect(territory.businessTravelerSuitability.hasTransportAccess).toBe(true);
    expect(territory.businessTravelerSuitability.level).not.toBe('weak');
    expect(territory.comparisonVector.businessTravelerSuitabilityScore).toBe(
      territory.businessTravelerSuitability.score,
    );
    expect(analysis.evergreenIndex).toBe(beforeScore);
  });
});
