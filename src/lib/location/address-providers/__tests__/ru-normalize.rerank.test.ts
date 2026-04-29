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

  it('prefers Санкт-Петербург for "ушинского 7, к1" when no city is in the query', () => {
    const { normalized } = normalizeRuAddressQuery('ушинского 7, к1');
    const input = rows([
      'улица Ушинского, 7, Пермь',
      'улица Ушинского, 7, Абакан',
      'улица Ушинского, 7, Майкоп',
      'улица Ушинского, 7, Нижний Тагил',
      'улица Ушинского, 7к1, Санкт-Петербург',
      'улица Ушинского, 7, Москва',
    ]);
    const out = rerankRuSuggestionsByLocality(normalized, input);
    expect(out[0]?.value).toContain('улица Ушинского');
    expect(out[0]?.value).toContain('7к1');
    expect(out[0]?.value).toContain('Санкт-Петербург');
  });

  it('respects an explicit city — does not force SPb when user typed Москва', () => {
    const { normalized } = normalizeRuAddressQuery('Москва, ушинского 7');
    const input = rows([
      'улица Ушинского, 7, Москва',
      'улица Ушинского, 7к1, Санкт-Петербург',
      'улица Ушинского, 7, Пермь',
    ]);
    const out = rerankRuSuggestionsByLocality(normalized, input);
    expect(out[0]?.value).toContain('Москва');
  });
});

