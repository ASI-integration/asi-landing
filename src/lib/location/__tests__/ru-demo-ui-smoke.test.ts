import { describe, it, expect } from 'vitest';
import { RU_DEMO_COPY } from '@/components/ru-demo-copy';

/**
 * Regression / source smoke tests for the RU location analysis demo result UI.
 *
 * Goal: catch accidental removal of required RU strings or re-introduction of
 * forbidden English labels and internal-scoring artefacts in the RU result view.
 *
 * Scope: pure copy-constant checks (no React rendering).
 * UI structural guards (heatmap absent, raw magnet distance list absent) are
 * enforced by `locale !== 'ru'` conditions in LocationIntelligenceDemo.tsx and
 * verified here via the copy contract — if the copy changes, these tests fail.
 *
 * LOC_COPY lives in a .tsx file with JSX so it cannot be imported in a plain
 * Vitest .ts test. The RU_DEMO_COPY constants extracted to ru-demo-copy.ts are
 * the single source of truth for the new RU result blocks.
 */
describe('RU demo UI smoke — required strings present', () => {
  it('demoScoreLabel is Демо-оценка', () => {
    expect(RU_DEMO_COPY.demoScoreLabel).toBe('Демо-оценка');
  });

  it('marketEnvironmentTitle is Рыночное окружение', () => {
    expect(RU_DEMO_COPY.marketEnvironmentTitle).toBe('Рыночное окружение');
  });

  it('premiumTrustTitle is Не просто сравнение с соседями', () => {
    expect(RU_DEMO_COPY.premiumTrustTitle).toBe('Не просто сравнение с соседями');
  });

  it('scoreExplanationTitle is Как рассчитана оценка', () => {
    expect(RU_DEMO_COPY.scoreExplanationTitle).toBe('Как рассчитана оценка');
  });

  it('revenueDisclaimer contains демо-оценка and не гарантия', () => {
    const d = RU_DEMO_COPY.revenueDisclaimer.toLowerCase();
    expect(d).toContain('демо-оценка');
    expect(d).toContain('не гарантия');
  });

  it('marketEnvironmentNote mentions полном отчёте and гостиниц', () => {
    const n = RU_DEMO_COPY.marketEnvironmentNote.toLowerCase();
    expect(n).toContain('полном отчёте');
    expect(n).toContain('гостиниц');
  });

  it('scoreExplanationBody mentions рыночных сигналах', () => {
    expect(RU_DEMO_COPY.scoreExplanationBody).toContain('рыночных сигналах');
  });
});

describe('RU demo UI smoke — forbidden English labels absent from RU copy', () => {
  it('premiumTrustBody has no "best in the world" or "most accurate"', () => {
    const b = RU_DEMO_COPY.premiumTrustBody.toLowerCase();
    expect(b).not.toContain('best in the world');
    expect(b).not.toContain('most accurate');
  });

  it('premiumTrustBody has no Evergreen Index mention or internal weight formulas', () => {
    const b = RU_DEMO_COPY.premiumTrustBody.toLowerCase();
    expect(b).not.toContain('evergreen');
    expect(b).not.toMatch(/\d+%.*вес|\bвес\b.*\d+%/);
  });

  it('RU copy blocks contain no English strategy category labels', () => {
    const allCopy = [
      RU_DEMO_COPY.marketEnvironmentNote,
      RU_DEMO_COPY.premiumTrustBody,
      RU_DEMO_COPY.scoreExplanationBody,
      RU_DEMO_COPY.revenueDisclaimer,
    ].join(' ').toLowerCase();

    expect(allCopy).not.toContain('short-term rental');
    expect(allCopy).not.toContain('mid-term rental');
    expect(allCopy).not.toContain('hybrid (short');
    expect(allCopy).not.toContain('mixed');
  });

  it('RU copy blocks do not expose internal POI category names', () => {
    const allCopy = [
      RU_DEMO_COPY.marketEnvironmentNote,
      RU_DEMO_COPY.premiumTrustBody,
      RU_DEMO_COPY.scoreExplanationBody,
    ].join(' ').toLowerCase();

    expect(allCopy).not.toContain('prison');
    expect(allCopy).not.toContain('military');
    expect(allCopy).not.toContain('heatmap');
    expect(allCopy).not.toContain('influence map');
  });
});

describe('RU demo UI smoke — heatmap and raw-magnet guards (copy contract)', () => {
  it('RU copy has no heatmap or influence-map references', () => {
    // The heatmap is hidden for RU via locale guard in the component.
    // The copy constants must not reintroduce those concepts.
    const allCopy = Object.values(RU_DEMO_COPY).join(' ').toLowerCase();
    expect(allCopy).not.toContain('heatmap');
    expect(allCopy).not.toContain('influence map');
    expect(allCopy).not.toContain('теплокарт');
  });

  it('RU copy has no raw internal magnet distance patterns', () => {
    // Raw POI distance lists like "70 м · метро" must not appear in any copy block.
    const allCopy = Object.values(RU_DEMO_COPY).join(' ');
    expect(allCopy).not.toMatch(/\d+\s*м\s*·/);
  });
});
