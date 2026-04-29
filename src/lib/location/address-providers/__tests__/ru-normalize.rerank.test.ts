import { describe, expect, it } from 'vitest';
import { normalizeRuAddressQuery, rerankRuSuggestionsByLocality } from '../ru-normalize';

function rows(values: string[]): Array<{ value: string }> {
  return values.map(value => ({ value }));
}

const SPB = { contextCity: 'Санкт-Петербург' as const };

describe('ru-normalize: rerankRuSuggestionsByLocality', () => {
  it('prefers Saint Petersburg for Полтавский пер., 2 with SPb context', () => {
    const { normalized } = normalizeRuAddressQuery('Полтавский пер., 2');
    const input = rows([
      'Москва, Полтавская улица, 2',
      'Санкт-Петербург, Полтавский переулок, 2',
      'Санкт-Петербург, Полтавский переулок, 20',
    ]);
    const out = rerankRuSuggestionsByLocality(normalized, input, SPB);
    expect(out[0]?.value).toContain('Санкт-Петербург');
    expect(out[0]?.value).toContain('Полтав');
    expect(out[0]?.value).toContain(', 2');
  });

  it('prefers Saint Petersburg for Полтавский переулок, 2 with SPb context', () => {
    const { normalized } = normalizeRuAddressQuery('Полтавский переулок, 2');
    const input = rows([
      'Москва, Полтавская улица, 2',
      'Санкт-Петербург, Полтавский переулок, 2',
      'Москва, Полтавский переулок, 2',
    ]);
    const out = rerankRuSuggestionsByLocality(normalized, input, SPB);
    expect(out[0]?.value).toContain('Санкт-Петербург');
    expect(out[0]?.value).toContain(', 2');
  });

  it('prefers Санкт-Петербург for "ушинского 7, к1" when SPb context is supplied', () => {
    const { normalized } = normalizeRuAddressQuery('ушинского 7, к1');
    const input = rows([
      'улица Ушинского, 7, Пермь',
      'улица Ушинского, 7, Абакан',
      'улица Ушинского, 7, Майкоп',
      'улица Ушинского, 7, Нижний Тагил',
      'улица Ушинского, 7к1, Санкт-Петербург',
      'улица Ушинского, 7, Москва',
    ]);
    const out = rerankRuSuggestionsByLocality(normalized, input, SPB);
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
    // Even with SPb context, an explicit city in the query wins.
    const out = rerankRuSuggestionsByLocality(normalized, input, SPB);
    expect(out[0]?.value).toContain('Москва');
  });

  // ── Regression: address-context ranking (no hardcoded SPb default) ──────────

  it('SPb context: "улица Маяковского, 6" prefers central SPb over Левашово/Сергиево/Ленобласть', () => {
    const { normalized } = normalizeRuAddressQuery('улица Маяковского, 6');
    const input = rows([
      'Левашово, улица Маяковского, 6, Санкт-Петербург',
      'Сергиево, улица Маяковского, 6, Санкт-Петербург',
      'Ленинградская область, улица Маяковского, 6',
      'улица Маяковского, 6, Санкт-Петербург',
      'улица Маяковского, 6, Екатеринбург',
    ]);
    const out = rerankRuSuggestionsByLocality(normalized, input, SPB);
    // Central SPb (no leading settlement segment) must win.
    expect(out[0]?.value).toBe('улица Маяковского, 6, Санкт-Петербург');
  });

  it('no context: "улица Маяковского, 6" returns city-disambiguated candidates and does not silently pick Левашово', () => {
    const { normalized } = normalizeRuAddressQuery('улица Маяковского, 6');
    const input = rows([
      'Левашово, улица Маяковского, 6',
      'улица Маяковского, 6, Екатеринбург',
      'улица Маяковского, 6, Санкт-Петербург',
      'улица Маяковского, 6, Владивосток',
    ]);
    const out = rerankRuSuggestionsByLocality(normalized, input);
    // No Левашово at top — settlement candidates must rank below city-proper
    // candidates when the user did not type the settlement.
    expect(out[0]?.value).not.toContain('Левашово');
    // Result set must keep multiple distinct cities so the UI can disambiguate.
    const cities = new Set(out.slice(0, 4).map(r => r.value));
    expect(cities.size).toBeGreaterThanOrEqual(3);
  });

  it('no context, explicit city in query: "улица Маяковского, 6, Екатеринбург" prioritizes Екатеринбург', () => {
    const { normalized } = normalizeRuAddressQuery('улица Маяковского, 6, Екатеринбург');
    const input = rows([
      'улица Маяковского, 6, Санкт-Петербург',
      'улица Маяковского, 6, Москва',
      'улица Маяковского, 6, Екатеринбург',
      'Левашово, улица Маяковского, 6',
    ]);
    const out = rerankRuSuggestionsByLocality(normalized, input);
    expect(out[0]?.value).toContain('Екатеринбург');
  });

  it('no context, explicit settlement typed: "Левашово, улица Маяковского, 6" honors Левашово', () => {
    const { normalized } = normalizeRuAddressQuery('Левашово, улица Маяковского, 6');
    const input = rows([
      'улица Маяковского, 6, Санкт-Петербург',
      'Левашово, улица Маяковского, 6, Санкт-Петербург',
      'улица Маяковского, 6, Екатеринбург',
    ]);
    const out = rerankRuSuggestionsByLocality(normalized, input);
    expect(out[0]?.value).toContain('Левашово');
  });
});
