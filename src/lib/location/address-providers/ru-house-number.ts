/**
 * Detect free-text queries that likely specify a street + building number (RU-centric).
 * Used to prefer address-level geocoding hits over POI establishments (clinics, offices).
 */

export function looksLikeRuStreetWithHouseNumber(query: string): boolean {
  const q = query.trim();
  if (q.length < 8) return false;

  // "...проспект Пархоменко, 15, Санкт-Петербург"
  if (/,\s*\d{1,4}[а-яёА-ЯЁa-zA-Z]?\s*,/u.test(q)) return true;

  // "...улица X, 15"
  if (/,\s*\d{1,4}[а-яёА-ЯЁa-zA-Z]?\s*$/u.test(q)) return true;

  // "дом 15", "д.15", "д. 3" после названия улицы
  if (/\bд(?:ом)?\.?\s*\d{1,4}\b/ui.test(q)) return true;
  if (/,\s*д\.?\s*\d{1,4}\b/ui.test(q)) return true;

  // "ул. ... 15" / "...15 к1"
  if (/\b\d{1,4}[а-яёА-ЯЁa-zA-Z]?\s*(?:к\s*\d+)?\s*,\s*[А-ЯЁ]/iu.test(q)) return true;

  return false;
}
