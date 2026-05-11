import { describe, expect, it } from 'vitest';
import {
  generalizeRuPublicScoreExplanation,
  normalizeRuDemoExplanationLines,
} from '../demo-public-copy';

describe('demo-public-copy', () => {
  it('strips named anchors into generic деловой copy where patterns remain gated downstream', () => {
    const out = generalizeRuPublicScoreExplanation('Деловой поток: Балтийский завод (700 м, завод)');
    expect(out).toBe('Рядом производственные и деловые объекты в зоне доступности.');
    expect(out).not.toContain('Балтийский');
  });

  it('drops ключевой транспортный якорь phrasing from generalizer (evidence handles)', () => {
    expect(
      generalizeRuPublicScoreExplanation(
        'Ключевой транспортный якорь: Балтийский завод (1 000 м, ж/д вокзал)',
      ),
    ).toBeNull();
  });

  it('normalizeRuDemoExplanationLines caps length and collapses duplicate semantic buckets', () => {
    const out = normalizeRuDemoExplanationLines(
      [
        'Metro доступно без автомобиля — гостям проще добираться без такси.',
        'Metro доступно без автомобиля — гостям проще добираться без такси.',
        'Конкурентное давление ниже среднего — проще занять нишу и удерживать цену.',
      ],
      { max: 5 },
    );
    expect(out.length).toBe(2);
    expect(out.filter(l => /Метро/i.test(l)).length).toBe(1);
  });
});
