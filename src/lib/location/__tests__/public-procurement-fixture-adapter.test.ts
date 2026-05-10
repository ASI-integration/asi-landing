import { describe, expect, it } from 'vitest';
import {
  collectUrbanDevelopmentSignals,
  normalizeUrbanDevelopmentSignals,
  urbanDevelopmentSnapshotFromSignals,
} from '../data-sources/urban-development';
import {
  createDefaultSamplePublicProcurementFixtureAdapter,
  createPublicProcurementFixtureAdapter,
} from '../data-sources/public-procurement/public-procurement-fixture-adapter';
import sampleNoticesFixture from '../data-sources/public-procurement/fixtures/sample-notices.json';

describe('public procurement fixture adapter', () => {
  it('parses bundled fixture and emits one signal per matching-region notice', async () => {
    const adapter = createPublicProcurementFixtureAdapter({
      fixture: sampleNoticesFixture as unknown,
      id: 'test.procurement',
      label: 'test',
    });

    const raw = await adapter.collect({ regionOrCity: 'Москва', locale: 'ru' });
    expect(raw).toHaveLength(12);

    const result = await collectUrbanDevelopmentSignals({ regionOrCity: 'Москва', locale: 'ru' }, [adapter]);
    expect(result.status).toBe('collected');
    expect(result.signals).toHaveLength(12);
  });

  it('classifies thematic notices into expected signal types and lifecycle stages', async () => {
    const adapter = createDefaultSamplePublicProcurementFixtureAdapter();
    const normalized = normalizeUrbanDevelopmentSignals(
      await adapter.collect({ regionOrCity: 'Москва', locale: 'ru' }),
    );

    const byId = new Map(
      normalized.flatMap(s => {
        const id = s.evidence.find(e => e.label === 'Идентификатор закупки')?.detail;
        return id ? [[id, s] as const] : [];
      }),
    );

    expect(byId.get('FX-IZY-001')).toMatchObject({
      signalType: 'engineering_survey',
      lifecycleStage: 'procurement',
      status: 'procurement',
      confidence: 'high',
    });

    expect(byId.get('FX-PLAN-002')).toMatchObject({
      signalType: 'planning_contract',
      lifecycleStage: 'procurement',
      status: 'procurement',
    });

    expect(byId.get('FX-DOC-003')).toMatchObject({
      signalType: 'design_documentation',
      lifecycleStage: 'procurement',
    });

    expect(byId.get('FX-ROAD-NEW-004')).toMatchObject({
      signalType: 'road_project',
      lifecycleStage: 'construction_preparation',
      status: 'planned',
    });

    expect(byId.get('FX-INT-009')).toMatchObject({
      signalType: 'road_project',
      lifecycleStage: 'design',
      status: 'in_design',
    });

    expect(byId.get('FX-HUB-010')).toMatchObject({
      signalType: 'transport_hub',
      lifecycleStage: 'procurement',
    });

    expect(byId.get('FX-NETS-011')).toMatchObject({
      signalType: 'infrastructure_plan_doc',
      lifecycleStage: 'construction_preparation',
    });

    expect(byId.get('FX-SPB-012')).toBeUndefined();
  });

  it('falls back to generic procurement when no urban thematic needles match', async () => {
    const adapter = createPublicProcurementFixtureAdapter({
      fixture: sampleNoticesFixture as unknown,
    });
    const [spb] = normalizeUrbanDevelopmentSignals(
      await adapter.collect({ regionOrCity: 'Санкт-Петербург', locale: 'ru' }),
    );

    expect(spb.signalType).toBe('government_procurement');
    expect(spb.lifecycleStage).toBe('procurement');
    expect(spb.confidence).toBe('low');
    expect(spb.manualVerificationNeeded).toBe(true);
  });

  it('normalization preserves lifecycleStage and snapshot mapping includes stage line', async () => {
    const adapter = createDefaultSamplePublicProcurementFixtureAdapter();
    const normalized = normalizeUrbanDevelopmentSignals(
      await adapter.collect({ regionOrCity: 'Москва', locale: 'ru' }),
    );
    expect(normalized.every(s => s.lifecycleStage !== undefined)).toBe(true);

    const snapshot = urbanDevelopmentSnapshotFromSignals(normalized);
    const notes = snapshot.plannedConstructionProjects.flatMap(p => p.notes).join('\n');
    expect(notes).toContain('Lifecycle stage: procurement');
    expect(notes).toContain('Lifecycle stage: construction_preparation');
    expect(notes).toContain('Lifecycle stage: design');
  });

  it('uses keyword planning lifecycle when procedure text is silent', async () => {
    const adapter = createPublicProcurementFixtureAdapter({
      fixture: {
        notices: [
          {
            id: 'SYN-PLAN-ONLY',
            title: 'Разработка проекта планировки промышленной зоны',
            regionHint: 'Тула',
            url: 'https://example.gov/SYN-PLAN-ONLY',
          },
        ],
      },
    });

    const [row] = normalizeUrbanDevelopmentSignals(
      await adapter.collect({ regionOrCity: 'Тула', locale: 'ru' }),
    );
    expect(row.signalType).toBe('planning_contract');
    expect(row.lifecycleStage).toBe('planning');
    expect(row.status).toBe('planned');
  });
});
