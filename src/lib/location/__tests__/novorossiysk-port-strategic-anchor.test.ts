import { describe, expect, it } from 'vitest';
import { buildAnalysis } from '../gravity-scoring';
import type { OSMElement } from '../types';
import { buildLocationStandaloneReport } from '../standalone-report';
import { buildLocationDecision } from '../location-decision-kernel';
import { buildFreeLocationReportViewModel } from '../free-report-renderer';
import {
  buildFullLocationReport,
  locationReportInputFromLegacy,
} from '../unified-report';
import {
  PORT_LOGISTICS_DEMAND_EXPLANATION_RU,
} from '../strategic-transport-hub';
import { buildPortCityStrategicContextCopyRu } from '../location-evidence-anchor';
import { formatRuResidentialEvidenceRowRu } from '../ru-residential-ui-projection';
import { publicScorePresentationFromDecision } from '../location-score-public';

const subject = { lat: 44.7212, lon: 37.7704 };

function osmAt(
  id: number,
  dLat: number,
  dLon: number,
  tags: Record<string, string>,
): OSMElement {
  return {
    type: 'way',
    id,
    center: { lat: subject.lat + dLat, lon: subject.lon + dLon },
    tags,
  };
}

describe('Novorossiysk port strategic anchor regression', () => {
  it('promotes Port of Novorossiysk ahead of repeated medical anchors for STR business demand', () => {
    const elements: OSMElement[] = [
      osmAt(1, 0.001, 0.006, {
        name: 'Порт Новороссийск',
        landuse: 'harbour',
        harbour: 'yes',
      }),
      osmAt(2, 0.002, 0.002, {
        name: 'Онкологический диспансер',
        amenity: 'hospital',
        healthcare: 'hospital',
      }),
      osmAt(3, 0.00201, 0.00201, {
        name: 'ГБУЗ Онкологический диспансер',
        amenity: 'hospital',
        healthcare: 'hospital',
      }),
      osmAt(4, 0.003, 0.004, {
        name: 'Автовокзал Новороссийск',
        amenity: 'bus_station',
      }),
    ];

    const analysis = buildAnalysis(elements, subject.lat, subject.lon);
    const decision = buildLocationDecision({
      analysis,
      inputAddress: 'Новороссийск, центр рядом с портом',
      coordinates: subject,
      rawElements: elements,
      locale: 'ru',
    });
    const publicDriverLines = decision.publicSummary?.publicDrivers.map(row => row.textRu) ?? [];
    const firstPublicMedicalIndex = publicDriverLines.findIndex(line => /онколог|медицин/i.test(line));
    const firstPublicPortIndex = publicDriverLines.findIndex(line => /порт|логист/i.test(line));

    expect(firstPublicPortIndex).toBeGreaterThanOrEqual(0);
    if (firstPublicMedicalIndex >= 0) expect(firstPublicPortIndex).toBeLessThan(firstPublicMedicalIndex);
    expect(publicDriverLines.join(' ')).toContain('командированных');

    const strongestNames = analysis.strongestMagnets.map(m => m.name).join(' ');

    expect(strongestNames).toContain('Порт Новороссийск');
    expect(analysis.audienceAnalysis.primaryAudience).toBe('BUSINESS');
    expect(analysis.audienceAnalysis.primaryDriverLabel).toContain(PORT_LOGISTICS_DEMAND_EXPLANATION_RU);

    const input = locationReportInputFromLegacy({
      address: 'Новороссийск, центр рядом с портом',
      locale: 'ru',
      mode: 'residential',
    });
    const unified = buildFullLocationReport(input, { analysis });
    const drivers = unified.signals.demand.guestDemandDrivers;

    expect(drivers[0]).toContain(PORT_LOGISTICS_DEMAND_EXPLANATION_RU);
    expect(drivers.join(' ')).toContain('Порт Новороссийск');
    const firstMedicalIndex = drivers.findIndex(line => /онколог/i.test(line));
    const firstPortIndex = drivers.findIndex(line => line.includes('Порт Новороссийск'));
    expect(firstPortIndex).toBeGreaterThanOrEqual(0);
    if (firstMedicalIndex >= 0) expect(firstPortIndex).toBeLessThan(firstMedicalIndex);

    const report = buildLocationStandaloneReport({
      address: 'Новороссийск, центр рядом с портом',
      analysis,
      verdict: 'Полный отчёт.',
      reportMode: 'paid',
    });

    const magnets = report.sections.find(section => section.id === 'magnets');
    expect(magnets?.id).toBe('magnets');
    if (magnets?.id !== 'magnets') throw new Error('magnets section missing');
    expect([...magnets.primary, ...magnets.secondary].some(m => m.name.includes('Порт Новороссийск'))).toBe(true);
    expect(report.strReport?.signalGroups.businessCorporateRu.join(' ')).toContain(PORT_LOGISTICS_DEMAND_EXPLANATION_RU);
  });

  it('uses explicit canonical port-logistics fallback when OSM misses the port object', () => {
    const elements: OSMElement[] = [
      osmAt(21, 0.002, 0.002, {
        name: 'Онкологический диспансер',
        amenity: 'hospital',
        healthcare: 'hospital',
      }),
      osmAt(22, 0.00201, 0.00201, {
        name: 'ГБУЗ Онкологический диспансер',
        amenity: 'hospital',
        healthcare: 'hospital',
      }),
    ];

    const analysis = buildAnalysis(elements, subject.lat, subject.lon);
    const decision = buildLocationDecision({
      analysis,
      inputAddress: 'Новороссийск, улица Советов, 10',
      coordinates: subject,
      rawElements: elements,
      locale: 'ru',
    });
    const publicDriverLines = decision.publicSummary?.publicDrivers.map(row => row.textRu) ?? [];
    const freeReport = buildFreeLocationReportViewModel({
      address: 'Новороссийск, улица Советов, 10',
      decision,
      analysis,
    });

    const expectedPortCopy = buildPortCityStrategicContextCopyRu('Новороссийск');
    expect(publicDriverLines[0]).toBe(expectedPortCopy);
    expect(publicDriverLines[0]).toContain('Городовой фактор спроса');
    expect(publicDriverLines[0]).not.toMatch(/\b0\s*м\b/);
    expect(freeReport.topEvidenceBullets[0]?.shortReason).toBe(expectedPortCopy);
    expect(freeReport.topEvidenceBullets[0]?.distanceLabel).toBeNull();
    expect(freeReport.shortRecommendation).toContain('городовой фактор спроса');
    expect(decision.publicSummary?.audienceVerdictRu).not.toMatch(/Слабый спрос/i);

    const portEvidence = decision.evidenceItems.find(
      e => e.factId === 'mf:canonical:market_context_port',
    );
    expect(portEvidence?.distanceMeters).toBeNull();
    expect(portEvidence?.anchorKind).toBe('city_level_strategic');
    expect(formatRuResidentialEvidenceRowRu(portEvidence!)).toBe(expectedPortCopy);
    expect(formatRuResidentialEvidenceRowRu(portEvidence!)).not.toMatch(/\b0\s*м\b/);

    const scoreLabel = publicScorePresentationFromDecision(decision)?.labelRu ?? '';
    expect(scoreLabel).not.toMatch(/15.?25\s*%/);
    expect(scoreLabel).toMatch(/требует полной проверки|недостаточно/i);
  });

  it('deduplicates repeated medical anchors by normalized name, category, distance, and coordinates', () => {
    const elements: OSMElement[] = [
      osmAt(11, 0.001, 0.001, {
        name: 'Онкологический диспансер',
        amenity: 'hospital',
        healthcare: 'hospital',
      }),
      osmAt(12, 0.00101, 0.00101, {
        name: 'ГБУЗ Онкологический диспансер',
        amenity: 'hospital',
        healthcare: 'hospital',
      }),
      osmAt(13, 0.004, 0.004, {
        name: 'Городская больница',
        amenity: 'hospital',
        healthcare: 'hospital',
      }),
    ];

    const analysis = buildAnalysis(elements, subject.lat, subject.lon);
    const oncology = analysis.magnets.filter(m => /онколог/i.test(m.name));

    expect(oncology).toHaveLength(1);
    expect(analysis.magnetCountByCategory.hospital).toBe(2);
  });
});
