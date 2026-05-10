import { describe, it, expect } from 'vitest';
import type { OSMElement } from '../types';
import { buildAnalysis } from '../gravity-scoring';
import {
  STRATEGIC_TRANSPORT_PRIMARY_RADIUS_M,
  STRATEGIC_TRANSPORT_SECONDARY_RADIUS_M,
  STRATEGIC_TRANSPORT_FETCH_RADIUS_M,
} from '../strategic-transport-hub';
import {
  SPECIALIZED_MEDICAL_FETCH_RADIUS_M,
  ORDINARY_HOSPITAL_SCORING_RADIUS_M,
} from '../specialized-medical-anchor';

/** ~ ул. Солдата Корзуна 12к */
const korzunLat = 59.8369;
const korzunLon = 30.3178;

describe('Korzun St Petersburg regression (fixtures)', () => {
  const pulkovoOsm: OSMElement = {
    type: 'node',
    id: 99,
    lat: 59.800278,
    lon: 30.262503,
    tags: { aeroway: 'aerodrome', name: 'Пулково' },
  };

  /** ~4 km east — harbour / secondary strategic band */
  const portHarbour: OSMElement = {
    type: 'way',
    id: 200,
    center: { lat: korzunLat, lon: korzunLon + 0.071 },
    tags: { landuse: 'harbour', name: 'Тестовый порт' },
  };

  /** ~2 km east — children's hospital beyond ordinary hospital fetch radius behaviour */
  const childrensHospital: OSMElement = {
    type: 'node',
    id: 201,
    lat: korzunLat,
    lon: korzunLon + 0.036,
    tags: { amenity: 'hospital', name: 'Детская городская больница № 99 (тест)' },
  };

  /** ~2 km west — surgical dental */
  const dentalSurgery: OSMElement = {
    type: 'node',
    id: 202,
    lat: korzunLat,
    lon: korzunLon - 0.036,
    tags: { amenity: 'dentist', name: 'Отделение челюстно-лицевой хирургии (тест)' },
  };

  /** Ordinary dentist — classified out; diagnostics record suppression */
  const weakDental: OSMElement = {
    type: 'node',
    id: 203,
    lat: korzunLat,
    lon: korzunLon + 0.052,
    tags: { amenity: 'dentist', name: 'Стоматология «Улыбка»' },
  };

  it('captures Pulkovo, port, children hospital, and dental surgery with bounded score lift', () => {
    const metro: OSMElement = {
      type: 'node',
      id: 1,
      lat: korzunLat + 0.004,
      lon: korzunLon + 0.004,
      tags: { name: 'Тестовая', station: 'subway', railway: 'station' },
    };

    const baseline = buildAnalysis([metro], korzunLat, korzunLon);
    const full = buildAnalysis(
      [metro, pulkovoOsm, portHarbour, childrensHospital, dentalSurgery, weakDental],
      korzunLat,
      korzunLon,
    );

    const pulkovoHub = full.magnets.find(
      m => m.categoryId === 'strategicTransportHub' && m.subType === 'airport',
    );
    expect(pulkovoHub).toBeTruthy();
    expect(pulkovoHub!.distance).toBeGreaterThan(STRATEGIC_TRANSPORT_PRIMARY_RADIUS_M);
    expect(pulkovoHub!.distance).toBeLessThanOrEqual(STRATEGIC_TRANSPORT_FETCH_RADIUS_M);
    expect(pulkovoHub!.strategicReachBand).toBe('strategic');

    const portHub = full.magnets.find(m => m.categoryId === 'strategicTransportHub' && m.subType === 'port');
    expect(portHub).toBeTruthy();
    expect(portHub!.distance).toBeGreaterThan(STRATEGIC_TRANSPORT_PRIMARY_RADIUS_M);
    expect(portHub!.distance).toBeLessThanOrEqual(STRATEGIC_TRANSPORT_SECONDARY_RADIUS_M);
    expect(portHub!.strategicReachBand).toBe('secondary');

    const childMed = full.magnets.find(
      m => m.categoryId === 'specializedMedicalAnchor' && m.subType === 'children_hospital',
    );
    expect(childMed).toBeTruthy();
    expect(childMed!.distance).toBeGreaterThan(ORDINARY_HOSPITAL_SCORING_RADIUS_M);
    expect(childMed!.distance).toBeLessThanOrEqual(SPECIALIZED_MEDICAL_FETCH_RADIUS_M);

    const dental = full.magnets.find(
      m => m.categoryId === 'specializedMedicalAnchor' && m.subType === 'dental_surgery',
    );
    expect(dental).toBeTruthy();

    expect(full.magnets.some(m => m.categoryId === 'food' && m.distance > 1800)).toBe(false);

    const delta = full.evergreenIndex - baseline.evergreenIndex;
    expect(delta).toBeGreaterThanOrEqual(0);
    expect(delta).toBeLessThanOrEqual(22);

    expect(full.magnetDiagnostics?.queriedCandidates.length).toBeGreaterThanOrEqual(6);
    expect(full.magnetDiagnostics?.surfacedMagnets.length).toBeGreaterThan(0);
  });

  it('records suppressedMagnets when POI is returned but not surfaced', () => {
    const metro: OSMElement = {
      type: 'node',
      id: 1,
      lat: korzunLat + 0.003,
      lon: korzunLon + 0.003,
      tags: { name: 'Метро Локальное', station: 'subway', railway: 'station' },
    };
    const farHospital: OSMElement = {
      type: 'node',
      id: 900,
      lat: korzunLat + 0.022,
      lon: korzunLon + 0.022,
      tags: {
        amenity: 'hospital',
        name: 'Кабинет массажа и косметологии «Здоровье»',
      },
    };
    const analysis = buildAnalysis([metro, pulkovoOsm, farHospital], korzunLat, korzunLon);
    const suppressed = analysis.magnetDiagnostics?.suppressedMagnets ?? [];
    expect(
      suppressed.some(
        s =>
          s.reason === 'outside_radius' &&
          (s.name.includes('Кабинет массажа') || s.detail === 'ordinary_hospital_beyond_local_radius'),
      ),
    ).toBe(true);
  });

  it('suppresses weak dentist candidates with unknown_category', () => {
    const analysis = buildAnalysis([weakDental], korzunLat, korzunLon);
    const suppressed = analysis.magnetDiagnostics?.suppressedMagnets ?? [];
    expect(suppressed.some(s => s.reason === 'unknown_category')).toBe(true);
  });
});
