import { describe, expect, it } from 'vitest';
import type { OSMElement } from '../types';
import { buildAnalysis } from '../gravity-scoring';
import { buildLocationDecision } from '../location-decision-kernel';

const MOSCOW_ORIGIN = { lat: 55.7522, lon: 37.6156 };
const YALTA_ORIGIN = { lat: 44.495, lon: 34.166 };

function node(id: number, dLat: number, dLon: number, tags: Record<string, string>): OSMElement {
  return { type: 'node', id, lat: MOSCOW_ORIGIN.lat + dLat, lon: MOSCOW_ORIGIN.lon + dLon, tags };
}

function nodeAt(
  origin: { lat: number; lon: number },
  id: number,
  dLat: number,
  dLon: number,
  tags: Record<string, string>,
): OSMElement {
  return { type: 'node', id, lat: origin.lat + dLat, lon: origin.lon + dLon, tags };
}

describe('RU residential weak tourist public surface policy', () => {
  it('Moscow: «Эйфелева башня» replica + leisure pair must not become a public tourist driver', () => {
    const els: OSMElement[] = [
      node(1, 0.002, 0.0021, { amenity: 'cinema', name: 'Кинотеатр Север' }),
      node(2, 0.0022, 0.0023, { amenity: 'cinema', name: 'Кинотеатр Юг' }),
      node(3, 0.003, 0.0031, { tourism: 'attraction', name: 'Эйфелева башня' }),
    ];
    const analysis = buildAnalysis(els, MOSCOW_ORIGIN.lat, MOSCOW_ORIGIN.lon);
    const decision = buildLocationDecision({
      analysis,
      inputAddress: 'Москва, Ленинградский проспект 1',
      coordinates: MOSCOW_ORIGIN,
      rawElements: els,
      locale: 'ru',
    });
    const s = decision.publicSummary!;
    expect(s.publicDrivers.map(d => d.textRu).join('\n')).not.toMatch(/эйфелев|eiffel/i);
    expect(s.headlineRu).not.toBe('Туристический и событийный спрос: рядом есть точки досуга и интереса');
  });

  it('Moscow: butterfly exhibition + leisure pair must not yield tourist-primary headline alone', () => {
    const els: OSMElement[] = [
      node(10, 0.002, 0.0021, { amenity: 'cinema', name: 'Кинотеатр Рассвет' }),
      node(11, 0.0022, 0.0023, { amenity: 'cinema', name: 'Кинотеатр Заря' }),
      node(12, 0.003, 0.0031, { tourism: 'attraction', name: 'Выставка тропических бабочек' }),
    ];
    const analysis = buildAnalysis(els, MOSCOW_ORIGIN.lat, MOSCOW_ORIGIN.lon);
    const decision = buildLocationDecision({
      analysis,
      inputAddress: 'Москва, Большая Никитская 10',
      coordinates: MOSCOW_ORIGIN,
      rawElements: els,
      locale: 'ru',
    });
    const s = decision.publicSummary!;
    expect(s.headlineRu).not.toBe('Туристический и событийный спрос: рядом есть точки досуга и интереса');
    expect(s.publicDrivers.map(d => d.textRu).join('\n')).not.toMatch(/бабочек/i);
  });

  it('Moscow: neighbourhood museum ~850m without stadium/convention must not yield tourist-primary headline', () => {
    const els: OSMElement[] = [
      nodeAt(MOSCOW_ORIGIN, 20, 0.002, 0.0021, { amenity: 'cinema', name: 'Кино Парк' }),
      nodeAt(MOSCOW_ORIGIN, 21, 0.0022, 0.0023, { amenity: 'cinema', name: 'Кино Лента' }),
      nodeAt(MOSCOW_ORIGIN, 22, 0.0077, 0.0078, { tourism: 'museum', name: 'Музей истории города' }),
    ];
    const analysis = buildAnalysis(els, MOSCOW_ORIGIN.lat, MOSCOW_ORIGIN.lon);
    const decision = buildLocationDecision({
      analysis,
      inputAddress: 'Москва, Арбат 5',
      coordinates: MOSCOW_ORIGIN,
      rawElements: els,
      locale: 'ru',
    });
    const s = decision.publicSummary!;
    expect(s.headlineRu).not.toBe('Туристический и событийный спрос: рядом есть точки досуга и интереса');
  });

  it('Yalta: real stadium + leisure context keeps tourist/event headline path', () => {
    const els: OSMElement[] = [
      nodeAt(YALTA_ORIGIN, 30, 0.002, 0.0021, { leisure: 'stadium', name: 'Центральный стадион' }),
      nodeAt(YALTA_ORIGIN, 31, 0.0023, 0.0024, { amenity: 'cinema', name: 'Летний кинотеатр' }),
    ];
    const analysis = buildAnalysis(els, YALTA_ORIGIN.lat, YALTA_ORIGIN.lon);
    const decision = buildLocationDecision({
      analysis,
      inputAddress: 'Ялта, набережная им. Ленина 5',
      coordinates: YALTA_ORIGIN,
      rawElements: els,
      locale: 'ru',
    });
    const s = decision.publicSummary!;
    expect(s.primaryDemandType === 'tourist' || s.headlineRu.includes('Туристический')).toBe(true);
  });
});
