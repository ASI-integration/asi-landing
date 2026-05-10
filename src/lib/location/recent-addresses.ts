export const LOCATION_RECENT_ADDRESSES_KEY = 'location-demo:recentAddresses';
export const LOCATION_RECENT_ADDRESSES_MAX = 7;

export function mergeIntoRecentAddresses(prev: string[], incoming: string): string[] {
  const t = incoming.replace(/\s+/g, ' ').trim();
  if (!t) return prev;
  const deduped = prev.filter(x => x !== t);
  return [t, ...deduped].slice(0, LOCATION_RECENT_ADDRESSES_MAX);
}

export function parseRecentAddressesJson(raw: string | null): string[] {
  if (raw == null || raw === '') return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    return v
      .filter((x): x is string => typeof x === 'string')
      .map(s => s.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, LOCATION_RECENT_ADDRESSES_MAX);
  } catch {
    return [];
  }
}

export function readRecentAddressesFromStorage(storage: Storage | undefined): string[] {
  if (!storage) return [];
  try {
    return parseRecentAddressesJson(storage.getItem(LOCATION_RECENT_ADDRESSES_KEY));
  } catch {
    return [];
  }
}

export function writeRecentAddressesToStorage(storage: Storage | undefined, items: string[]): void {
  if (!storage) return;
  try {
    storage.setItem(LOCATION_RECENT_ADDRESSES_KEY, JSON.stringify(items.slice(0, LOCATION_RECENT_ADDRESSES_MAX)));
  } catch {
    /* quota / private mode */
  }
}

/** Persist last analyzed / chosen address strings (browser-only). */
export function rememberRecentAddress(address: string, storage: Storage | undefined = typeof window !== 'undefined' ? window.localStorage : undefined): void {
  const t = address.replace(/\s+/g, ' ').trim();
  if (!t) return;
  const prev = readRecentAddressesFromStorage(storage);
  writeRecentAddressesToStorage(storage, mergeIntoRecentAddresses(prev, address));
}
