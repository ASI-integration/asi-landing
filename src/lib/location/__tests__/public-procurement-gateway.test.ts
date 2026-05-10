import { describe, expect, it } from 'vitest';
import {
  normalizeUrbanDevelopmentSignals,
  urbanDevelopmentSnapshotFromSignals,
} from '../data-sources/urban-development';
import { createFixturePublicProcurementGateway } from '../data-sources/public-procurement/fixture-public-procurement-gateway';
import sampleNoticesFixture from '../data-sources/public-procurement/fixtures/sample-notices.json';
import { listAllProcurementGatewayPages } from '../data-sources/public-procurement/public-procurement-gateway';
import {
  runPublicProcurementIngestionPipeline,
  validatePublicProcurementRawNoticePayload,
} from '../data-sources/public-procurement/public-procurement-ingestion';

describe('public procurement gateway', () => {
  it('loads all fixture notices through paged listNotices', async () => {
    const gateway = createFixturePublicProcurementGateway({
      fixture: sampleNoticesFixture as unknown,
      sourceName: 'test.gateway.fixture',
    });

    let total = 0;
    let cursor: string | undefined;
    let pages = 0;
    let hasMore = true;
    while (hasMore) {
      pages += 1;
      const page = await gateway.listNotices({
        regionOrCity: 'Москва',
        pagination: { cursor, limit: 3 },
      });
      total += page.items.length;
      cursor = page.nextCursor;
      hasMore = page.hasMore;
    }

    expect(total).toBe(12);
    expect(pages).toBeGreaterThan(1);
  });

  it('filters by region at the gateway level', async () => {
    const gateway = createFixturePublicProcurementGateway({
      fixture: sampleNoticesFixture as unknown,
    });

    const msk = await listAllProcurementGatewayPages(gateway, { regionOrCity: 'Москва' });
    const spb = await listAllProcurementGatewayPages(gateway, { regionOrCity: 'Санкт-Петербург' });

    expect(msk).toHaveLength(12);
    expect(spb).toHaveLength(1);
    expect(spb[0]?.validated.id).toBe('FX-SPB-012');
  });

  it('preserves provenance on normalized signals without leaking raw payloads', async () => {
    const gateway = createFixturePublicProcurementGateway({
      fixture: sampleNoticesFixture as unknown,
      sourceName: 'fixture-provenance-test',
    });

    const [bundle] = await listAllProcurementGatewayPages(gateway, { regionOrCity: 'Москва' });
    expect(bundle).toBeDefined();

    const { signal } = runPublicProcurementIngestionPipeline(bundle!, {
      locale: 'ru',
      sourceName: gateway.sourceName,
    });

    expect(signal.sourceProvenance).toEqual({
      sourceName: 'fixture-provenance-test',
      sourceUrl: bundle!.validated.url,
      externalId: bundle!.validated.id,
      publishedAt: bundle!.validated.publishedAt,
      updatedAt: undefined,
      region: bundle!.validated.regionHint,
    });

    const serialized = JSON.stringify(signal);
    expect(serialized).not.toContain('rawPayload');
    expect(serialized).not.toContain('"customer"');
  });

  it('runs raw -> validated -> classified -> normalized pipeline', async () => {
    const raw = {
      id: 'PIPE-RAW-1',
      title: 'Разработка проекта планировки промышленной зоны',
      regionHint: 'Тула',
      url: 'https://example.gov/PIPE-RAW-1',
      auditVendorOnlyField: 'must-not-appear-on-signal',
      updatedAt: '2026-05-01',
    };

    const unit = validatePublicProcurementRawNoticePayload(raw);
    expect(unit.rawPayload).toMatchObject({ auditVendorOnlyField: 'must-not-appear-on-signal' });

    const { signal } = runPublicProcurementIngestionPipeline(unit, {
      locale: 'ru',
      sourceName: 'pipeline-test-source',
    });

    const [normalized] = normalizeUrbanDevelopmentSignals([signal]);
    expect(normalized.signalType).toBe('planning_contract');
    expect(normalized.lifecycleStage).toBe('planning');
    expect(normalized.sourceProvenance?.externalId).toBe('PIPE-RAW-1');
    expect(normalized.sourceProvenance?.updatedAt).toBe('2026-05-01');

    const snapshot = urbanDevelopmentSnapshotFromSignals([normalized]);
    expect(snapshot.plannedConstructionProjects.length).toBeGreaterThan(0);
    expect(JSON.stringify(snapshot)).not.toContain('auditVendorOnlyField');
  });
});
