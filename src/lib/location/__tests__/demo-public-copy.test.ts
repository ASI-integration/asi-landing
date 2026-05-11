import { describe, expect, it } from 'vitest';
import {
  generalizeRuPublicScoreExplanation,
  normalizeRuDemoExplanationLines,
} from '../demo-public-copy';

describe('demo-public-copy', () => {
  it('replaces «ключевой транспортный якорь» with neutral wording without POI name', () => {
    const out = generalizeRuPublicScoreExplanation(
      'Ключевой транспортный якорь: Балтийский завод (1 000 м, ж/д вокзал)',
    );
    expect(out).toBe('Крупный транспортный узел рядом — транспортная доступность усиливает спрос.');
    expect(out).not.toContain('Балтийский');
  });

  it('collapses деловой поток lines without завода names into category wording', () => {
    const out = generalizeRuPublicScoreExplanation(
      'Деловой поток: Балтийский завод (700 м, завод)',
    );
    expect(out).toBe('Рядом производственные и деловые объекты в зоне доступности.');
    expect(out).not.toContain('Балтийский');
  });

  it('normalizeRuDemoExplanationLines caps length and dedupes', () => {
    const out = normalizeRuDemoExplanationLines(
      [
        'Деловой поток: Завод X (400 м, завод)',
        'Деловой поток: Завод Y (500 м, завод)',
        'Ключевой транспортный якорь: Вокзал (120 м, ж/д вокзал)',
      ],
      5,
    );
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out.length).toBeLessThanOrEqual(5);
    const joined = out.join('\n');
    expect(joined).not.toMatch(/Завод [XY]/);
  });
});
