export interface StaffClues {
  bookingReference?: string;
  guestName?: string;
  propertyLocation?: string;
  checkInDate?: string; // YYYY-MM-DD
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function extractBookingReference(text: string): string | undefined {
  const t = text.trim();

  // Common operator patterns: "бронь 123456", "booking 123456", "ref AB123456", "№123456"
  const m1 = t.match(/(?:брон[ьи]|бронь|booking|ref(?:erence)?|№|номер)\s*[:#]?\s*([A-ZА-ЯЁ0-9][A-ZА-ЯЁ0-9-]{4,})/i);
  if (m1?.[1]) return m1[1].toUpperCase();

  // Bare long-ish token (avoid short numbers that are likely times/codes).
  const m2 = t.match(/\b([A-Z]{1,4}\d{5,}|\d{7,})\b/);
  if (m2?.[1]) return m2[1].toUpperCase();

  return undefined;
}

function extractCheckInDate(text: string): string | undefined {
  const t = text;

  // YYYY-MM-DD
  const iso = t.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // DD.MM.YYYY or DD/MM/YYYY
  const full = t.match(/\b(\d{1,2})[./](\d{1,2})[./](20\d{2})\b/);
  if (full) {
    const dd = String(full[1]).padStart(2, '0');
    const mm = String(full[2]).padStart(2, '0');
    const yyyy = full[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  // DD.MM (assume current year)
  const short = t.match(/\b(\d{1,2})[./](\d{1,2})\b/);
  if (short) {
    const dd = String(short[1]).padStart(2, '0');
    const mm = String(short[2]).padStart(2, '0');
    const yyyy = String(new Date().getFullYear());
    return `${yyyy}-${mm}-${dd}`;
  }

  return undefined;
}

function extractGuestName(text: string): string | undefined {
  // Cyrillic "Имя Фамилия" or "Фамилия Имя"
  const m = text.match(/\b([А-ЯЁ][а-яё]+)\s+([А-ЯЁ][а-яё]+)\b/);
  if (m?.[1] && m?.[2]) return `${m[1]} ${m[2]}`;
  return undefined;
}

function extractPropertyLocation(text: string): string | undefined {
  const t = text;

  // Explicit "адрес: ...", "объект: ...", "квартира: ..."
  const m1 = t.match(/(?:адрес|объект|квартира|апартаменты|жк|локация)\s*[:#]\s*(.{8,120})/i);
  if (m1?.[1]) return normalizeWhitespace(m1[1]).slice(0, 120);

  // Heuristic: take the first line containing street-ish markers.
  const lines = t.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const streety = lines.find(l => /(?:ул\.|улица|просп\.|проспект|пер\.|переулок|шоссе|дом|д\.|кв\.|корп\.|стр\.|лит\.)/i.test(l));
  if (streety) return normalizeWhitespace(streety).slice(0, 120);

  return undefined;
}

export function extractStaffClues(text: string): StaffClues {
  const bookingReference = extractBookingReference(text);
  const guestName = extractGuestName(text);
  const propertyLocation = extractPropertyLocation(text);
  const checkInDate = extractCheckInDate(text);

  return {
    ...(bookingReference ? { bookingReference } : null),
    ...(guestName ? { guestName } : null),
    ...(propertyLocation ? { propertyLocation } : null),
    ...(checkInDate ? { checkInDate } : null),
  };
}

