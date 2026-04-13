import { describe, expect, it } from 'vitest';
import { normalizeRuAddressQuery, rerankRuSuggestionsByLocality } from '../ru-normalize';

function rows(values: string[]): Array<{ value: string }> {
  return values.map(value => ({ value }));
}

describe('ru-normalize: rerankRuSuggestionsByLocality', () => {
  it('prefers Saint Petersburg for Полтавский пер., 2 when street+house match is stronger', () => {
    const { normalized } = normalizeRuAddressQuery('Полтавский пер., 2');
    const input = rows([
      'Москва, Полтавская улица, 2',
      'Санкт-Петербург, Полтавский переулок, 2',
      'Санкт-Петербург, Полтавский переулок, 20',
    ]);
    const out = rerankRuSuggestionsByLocality(normalized, input);
    expect(out[0]?.value).toContain('Санкт-Петербург');
    expect(out[0]?.value).toContain('Полтав');
    expect(out[0]?.value).toContain(', 2');
  });

  it('prefers Saint Petersburg for Полтавский переулок, 2', () => {
    const { normalized } = normalizeRuAddressQuery('Полтавский переулок, 2');
    const input = rows([
      'Москва, Полтавская улица, 2',
      'Санкт-Петербург, Полтавский переулок, 2',
      'Москва, Полтавский переулок, 2',
    ]);
    const out = rerankRuSuggestionsByLocality(normalized, input);
    expect(out[0]?.value).toContain('Санкт-Петербург');
    expect(out[0]?.value).toContain(', 2');
  });
});

