import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AddressSuggestionRow } from '../types';

type GooglePlacesAutocomplete = (
  query: string,
  key: string,
  opts?: Record<string, unknown>,
) => Promise<AddressSuggestionRow[]>;

const googlePlacesAutocompleteMock = vi.fn<GooglePlacesAutocomplete>();

vi.mock('../suggest-google', () => ({
  googlePlacesAutocomplete: googlePlacesAutocompleteMock,
}));

vi.mock('../suggest-2gis', () => ({
  twogisAddressSuggest: vi.fn(async () => []),
}));

vi.mock('../suggest-photon', () => ({
  photonSuggest: vi.fn(async () => []),
}));

vi.mock('../suggest-dadata', () => ({
  dadataAddressSuggest: vi.fn(async () => []),
}));

describe('suggest pipeline RU disambiguation', () => {
  afterEach(() => {
    googlePlacesAutocompleteMock.mockReset();
    delete process.env.GOOGLE_MAPS_SERVER_API_KEY;
  });

  it('keeps un-biased cross-region matches when a context city is present', async () => {
    process.env.GOOGLE_MAPS_SERVER_API_KEY = 'test-key';

    googlePlacesAutocompleteMock.mockImplementation(async (query: string) => {
      if (query.includes('Санкт-Петербург')) {
        return [
          {
            value: 'Оборонная улица, 37, Санкт-Петербург, Россия',
            lat: '59.884',
            lon: '30.279',
            placeId: 'spb',
          },
        ];
      }
      if (query.includes('Мурино')) {
        return [
          {
            value: 'Оборонная улица, 37, Мурино, Всеволожский район, Ленинградская область, Россия',
            lat: '60.054',
            lon: '30.443',
            placeId: 'murino',
          },
        ];
      }

      return [
        {
          value: 'улица Оборонная, 37, Богородицк, Тульская область, Россия',
          lat: '53.77',
          lon: '38.12',
          placeId: 'bogoroditsk',
        },
      ];
    });

    const { runSuggestPipeline } = await import('../suggest-pipeline');
    const result = await runSuggestPipeline('ru', 'Оборонная 37', {
      contextCity: 'Санкт-Петербург',
    });

    expect(googlePlacesAutocompleteMock).toHaveBeenCalledTimes(3);
    expect(googlePlacesAutocompleteMock.mock.calls.map(call => call[0])).toEqual([
      'Оборонная 37, Санкт-Петербург, Россия',
      'Оборонная 37, Мурино, Ленинградская область, Россия',
      'Оборонная 37',
    ]);
    expect(result.suggestions.map(s => s.value).slice(0, 2)).toEqual([
      'Оборонная улица, 37, Санкт-Петербург, Россия',
      'Оборонная улица, 37, Мурино, Всеволожский район, Ленинградская область, Россия',
    ]);
    expect(result.suggestions.map(s => s.value)).toContain(
      'улица Оборонная, 37, Богородицк, Тульская область, Россия',
    );
  });
});
