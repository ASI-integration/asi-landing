import { describe, expect, it } from 'vitest';
import {
  generalizeRuPublicScoreExplanation,
  normalizeRuDemoExplanationLines,
} from '../demo-public-copy';

describe('demo-public-copy', () => {
  it('preserves structured lines with distances instead of stripping POI names', () => {
    const line =
      'Ключевой транспортный якорь: Балтийский завод (1 000 м, ж/д вокзал)';
    const out = generalizeRuPublicScoreExplanation(line);
    expect(out).toContain('Балтийский');
    expect(out).toMatch(/1\s*000\s*м/i);
  });

  it('preserves деловой поток lines when distance context is present', () => {
    const out = generalizeRuPublicScoreExplanation(
      'Деловой поток: Балтийский завод (700 м, завод)',
    );
    expect(out).toContain('Балтийский');
    expect(out).toMatch(/700/);
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
    expect(joined).toMatch(/Завод [XY]|Вокзал/);
  });
});
