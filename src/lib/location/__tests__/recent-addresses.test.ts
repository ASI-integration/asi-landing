import { describe, expect, it } from 'vitest';
import {
  LOCATION_RECENT_ADDRESSES_MAX,
  mergeIntoRecentAddresses,
  parseRecentAddressesJson,
  rememberRecentAddress,
  LOCATION_RECENT_ADDRESSES_KEY,
} from '../recent-addresses';

function mockStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear(): void {
      store.clear();
    },
    getItem(key: string): string | null {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number): string | null {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    setItem(key: string, value: string): void {
      store.set(key, value);
    },
  };
}

describe('recent-addresses', () => {
  it('mergeIntoRecentAddresses trims, dedupes by exact match, moves newest first, caps length', () => {
    const a = mergeIntoRecentAddresses(['b', 'c'], '  a  ');
    expect(a).toEqual(['a', 'b', 'c']);
    expect(mergeIntoRecentAddresses(a, 'b')).toEqual(['b', 'a', 'c']);
    const many = mergeIntoRecentAddresses([], '1');
    let acc = many;
    for (let i = 2; i <= LOCATION_RECENT_ADDRESSES_MAX + 3; i++) acc = mergeIntoRecentAddresses(acc, String(i));
    expect(acc.length).toBe(LOCATION_RECENT_ADDRESSES_MAX);
    expect(acc[0]).toBe(String(LOCATION_RECENT_ADDRESSES_MAX + 3));
  });

  it('parseRecentAddressesJson rejects invalid JSON and non-arrays', () => {
    expect(parseRecentAddressesJson(null)).toEqual([]);
    expect(parseRecentAddressesJson('')).toEqual([]);
    expect(parseRecentAddressesJson('not json')).toEqual([]);
    expect(parseRecentAddressesJson('{}')).toEqual([]);
    expect(parseRecentAddressesJson(JSON.stringify([' x ', 1, 'y']))).toEqual(['x', 'y']);
  });

  it('rememberRecentAddress persists merged list to storage', () => {
    const storage = mockStorage();
    rememberRecentAddress('Адрес 1', storage);
    rememberRecentAddress('Адрес 2', storage);
    rememberRecentAddress('Адрес 1', storage);
    const raw = storage.getItem(LOCATION_RECENT_ADDRESSES_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!)).toEqual(['Адрес 1', 'Адрес 2']);
  });

  it('does not persist empty strings', () => {
    const storage = mockStorage();
    rememberRecentAddress('   ', storage);
    expect(storage.getItem(LOCATION_RECENT_ADDRESSES_KEY)).toBeNull();
  });
});
