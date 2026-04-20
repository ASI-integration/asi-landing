import { describe, it, expect } from 'vitest';
import type { OSMElement } from '../types';
import { buildAnalysis } from '../gravity-scoring';
import { buildLocationStandaloneReport } from '../standalone-report';

/**
 * Golden-address tests (deterministic, offline).
 *
 * Goal: catch logic drift between canonical policy (prime magnets),
 * selector/classifier, and report output shape.
 *
 * These fixtures intentionally avoid network fetches (Overpass/Google/etc.).
 */

describe('location-analysis golden addresses', () => {
  it('RU residential: suppresses excluded categories and keeps prime transport anchors', () => {
    const subject = { lat: 55.751, lon: 37.618 };

    const elements: OSMElement[] = [
      // Prime magnets (should be eligible)
      {
        type: 'relation',
        id: 101,
        center: { lat: 55.755, lon: 37.616 },
        tags: { name: 'Метро Охотный Ряд', station: 'subway', railway: 'station' },
      },
      {
        type: 'way',
        id: 102,
        center: { lat: 55.749, lon: 37.607 },
        tags: { name: 'Киевский вокзал', railway: 'station' },
      },
      {
        type: 'node',
        id: 103,
        lat: 55.7525,
        lon: 37.623,
        tags: { name: 'Городская больница №1', amenity: 'hospital' },
      },

      // Excluded categories for residential prime magnets (must not surface)
      {
        type: 'node',
        id: 201,
        lat: 55.7517,
        lon: 37.619,
        tags: { name: 'Кофейня у дома', amenity: 'cafe' },
      },
      {
        type: 'node',
        id: 202,
        lat: 55.7514,
        lon: 37.6175,
        tags: { name: 'Супермаркет', shop: 'supermarket' },
      },
    ];

    const analysis = buildAnalysis(elements, subject.lat, subject.lon);
    const report = buildLocationStandaloneReport({
      address: 'Москва, тестовая локация',
      analysis,
      verdict: 'ok',
      market: 'RU',
    });

    const magnetsSection = report.sections.find(s => s.id === 'magnets');
    expect(magnetsSection && magnetsSection.id === 'magnets').toBe(true);
    if (!magnetsSection || magnetsSection.id !== 'magnets') return;

    const surfacedNames = [...magnetsSection.primary, ...magnetsSection.secondary].map(m => m.name);
    expect(surfacedNames).toContain('Метро Охотный Ряд');
    expect(surfacedNames).toContain('Киевский вокзал');
    expect(surfacedNames).toContain('Городская больница №1');

    expect(surfacedNames).not.toContain('Кофейня у дома');
    expect(surfacedNames).not.toContain('Супермаркет');
  });

  it('INTERNATIONAL residential: suppresses conditional-persistence categories (stadium/convention) more aggressively', () => {
    // Keep anchors within the prime-magnet reporting radius.
    const subject = { lat: 51.5306, lon: -0.1242 };

    const elements: OSMElement[] = [
      // Transport anchor
      {
        type: 'relation',
        id: 301,
        center: { lat: 51.5308, lon: -0.1238 },
        tags: { name: "King's Cross St Pancras", railway: 'station' },
      },
      // Conditional persistence (should be suppressed in INTERNATIONAL market mode)
      {
        type: 'node',
        id: 302,
        lat: 51.5311,
        lon: -0.1236,
        tags: { name: 'Convention Centre', amenity: 'convention_centre' },
      },
      {
        type: 'node',
        id: 303,
        lat: 51.5312,
        lon: -0.1248,
        tags: { name: 'Stadium', leisure: 'stadium' },
      },
    ];

    const analysis = buildAnalysis(elements, subject.lat, subject.lon);
    const report = buildLocationStandaloneReport({
      address: 'London, test location',
      analysis,
      verdict: 'ok',
      market: 'INTERNATIONAL',
    });

    const magnetsSection = report.sections.find(s => s.id === 'magnets');
    expect(magnetsSection && magnetsSection.id === 'magnets').toBe(true);
    if (!magnetsSection || magnetsSection.id !== 'magnets') return;

    const surfacedCategories = [...magnetsSection.primary, ...magnetsSection.secondary].map(m => m.category_id);
    expect(surfacedCategories).toContain('railway_station');
    expect(surfacedCategories).not.toContain('convention');
    expect(surfacedCategories).not.toContain('stadium');
  });
});

