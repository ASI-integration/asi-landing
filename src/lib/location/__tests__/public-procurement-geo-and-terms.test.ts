import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifyPublicProcurementNotice } from '../data-sources/public-procurement/classify-notice';
import {
  composeProcurementLocationReference,
  extractPublicProcurementGeo,
} from '../data-sources/public-procurement/extract-public-procurement-geo';
import {
  extractGeoFromValidatedProcurementNotice,
  runPublicProcurementIngestionPipeline,
  validatePublicProcurementRawNoticePayload,
} from '../data-sources/public-procurement/public-procurement-ingestion';
import { normalizeUrbanDevelopmentSignals } from '../data-sources/urban-development';
import {
  lookupRuUrbanPlanningTerm,
  RU_URBAN_PLANNING_TERM_ENTRIES,
} from '../data-sources/public-procurement/ru-urban-planning-terms-dictionary';
import { PUBLIC_PROCUREMENT_URBAN_KEYWORD_RULES } from '../data-sources/public-procurement/urban-signals-dictionary';

describe('Russian urban planning terms glossary', () => {
  it('exposes a standalone reference dictionary with expected abbreviations', () => {
    const abbrevs = new Set(RU_URBAN_PLANNING_TERM_ENTRIES.map(e => e.abbreviation));
    for (const need of ['ЕИС', 'ППТ', 'ПМТ', 'ПД', 'РД', 'ИИ', 'ГПЗУ', 'ОКС', 'КРТ', 'ТПУ']) {
      expect(abbrevs.has(need)).toBe(true);
    }
    expect(lookupRuUrbanPlanningTerm('ппт')?.expansionRu).toContain('планировки');
    expect(lookupRuUrbanPlanningTerm('ТПУ')?.expansionRu).toContain('транспортно');
  });

  it('does not merge the glossary into the signal classifier dictionary module', () => {
    const classifySrc = readFileSync(
      resolve(process.cwd(), 'src/lib/location/data-sources/public-procurement/classify-notice.ts'),
      'utf8',
    );
    expect(classifySrc).not.toContain('ru-urban-planning-terms-dictionary');
    expect(PUBLIC_PROCUREMENT_URBAN_KEYWORD_RULES.length).toBeGreaterThan(0);
    expect(RU_URBAN_PLANNING_TERM_ENTRIES.length).toBe(10);
  });
});

describe('public procurement geography extraction', () => {
  it('extracts region from regionHint and matches audit snippets', () => {
    const geo = extractPublicProcurementGeo({
      id: 'G1',
      title: 'Тест',
      regionHint: 'Тульская область',
      subjectDetail: 'Работы на объекте',
    });
    expect(geo.extracted.region).toBe('Тульская область');
    expect(geo.sourceSnippets.some(s => s.field === 'regionHint' && s.text.includes('Тульская'))).toBe(true);
  });

  it('extracts city from structured subject text when region is an область', () => {
    const geo = extractPublicProcurementGeo({
      id: 'G2',
      title: 'Благоустройство',
      regionHint: 'Тульская область',
      subjectDetail: 'Объект в г. Тула, центральная часть.',
    });
    expect(geo.extracted.city).toBe('Тула');
    expect(composeProcurementLocationReference(geo.extracted)).toContain('Тульская область');
    expect(composeProcurementLocationReference(geo.extracted)).toContain('Тула');
  });

  it('extracts district and address phrases when present in fixture-like fields', () => {
    const geo = extractPublicProcurementGeo({
      id: 'FX-GEO-013',
      title: 'Капитальный ремонт фасада в Южном административном округе',
      regionHint: 'Москва',
      subjectDetail: 'Адрес объекта: ул. Варшавское шоссе, д. 150. Контрольный ориентир — ЮАО.',
    });
    expect(geo.extracted.districtOrOkrug).toMatch(/Южн/i);
    expect(geo.extracted.locationOrAddressHint).toMatch(/Варшавское шоссе/);
    expect(geo.sourceSnippets.some(s => s.field === 'subjectDetail' && /Варшавское/.test(s.text))).toBe(true);

    const loc = composeProcurementLocationReference(geo.extracted);
    expect(loc).toMatch(/Москва/);
    expect(loc).toMatch(/Южн/i);
    expect(loc).toMatch(/Варшавское/);
  });
});

describe('procurement pipeline: geo stage before classification', () => {
  it('runs validated → geo → classify → normalized signal and keeps snippets only in audit', () => {
    const raw = {
      id: 'GEO-PIPE-1',
      title: 'Работы в Северном административном округе',
      regionHint: 'Москва',
      subjectDetail: 'ул. Ленинградское шоссе, д. 56',
      url: 'https://example.gov/GEO-PIPE-1',
    };

    const unit = validatePublicProcurementRawNoticePayload(raw);
    const geoDirect = extractGeoFromValidatedProcurementNotice(unit.validated);
    expect(geoDirect.extracted.districtOrOkrug).toMatch(/Северн/i);

    const { signal, audit } = runPublicProcurementIngestionPipeline(unit, {
      locale: 'ru',
      sourceName: 'geo-pipeline-test',
    });

    expect(audit.geoExtraction.sourceSnippets.length).toBeGreaterThan(0);
    expect(classifyPublicProcurementNotice(unit.validated).signalType).toBeDefined();

    const [normalized] = normalizeUrbanDevelopmentSignals([signal]);
    expect(normalized.signalType).toBe('government_procurement');
    expect(normalized.locationReference).toMatch(/Москва/);
    expect(normalized.locationReference).toMatch(/Северн/i);
    expect(normalized.locationReference).toMatch(/Ленинградское/);

    const serialized = JSON.stringify(normalized);
    expect(serialized).not.toContain('sourceSnippets');
    expect(serialized).not.toContain('geoExtraction');
  });

  it('still emits thematic procurement signals unchanged after geo enrichment path', () => {
    const unit = validatePublicProcurementRawNoticePayload({
      id: 'GEO-PIPE-2',
      title: 'Разработка проекта планировки промышленной зоны',
      regionHint: 'Тула',
      procedureStage: 'Запрос котировок',
      url: 'https://example.gov/GEO-PIPE-2',
    });

    const { signal } = runPublicProcurementIngestionPipeline(unit, {
      locale: 'ru',
      sourceName: 'geo-pipeline-thematic',
    });

    const [normalized] = normalizeUrbanDevelopmentSignals([signal]);
    expect(normalized.signalType).toBe('planning_contract');
    expect(normalized.lifecycleStage).toBe('procurement');
    expect(normalized.locationReference).toContain('Тула');
  });
});
