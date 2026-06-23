import { randomUUID } from 'node:crypto';
import {
  BOOKING_CHANNEL_LABELS_RU,
  type BookingChannel,
  normalizeBookingChannel,
} from './types';

export type BookingTextImportConfidence = 'high' | 'medium' | 'low';

export type BookingTextImportCandidate = {
  propertyId: string | null;
  propertyLabel: string | null;
  guestName: string | null;
  guestContact: string | null;
  checkIn: string | null;
  checkOut: string | null;
  channel: BookingChannel;
  comment: string | null;
  confidence: BookingTextImportConfidence;
  missingFields: string[];
  reservationRef: string | null;
};

export type PropertyLookup = {
  propertyId: string;
  label: string;
};

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeRuDateToken(token: string, yearHint?: number): string | null {
  const raw = text(token);
  if (!raw) return null;

  const dotted = raw.match(/(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/);
  if (dotted) {
    const day = Number(dotted[1]);
    const month = Number(dotted[2]);
    let year = dotted[3] ? Number(dotted[3]) : yearHint ?? new Date().getFullYear();
    if (year < 100) year += 2000;
    if (day < 1 || day > 31 || month < 1 || month > 12) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const months: Record<string, number> = {
    январ: 1,
    феврал: 2,
    март: 3,
    апрел: 4,
    ма: 5,
    июн: 6,
    июл: 7,
    август: 8,
    сентябр: 9,
    октябр: 10,
    ноябр: 11,
    декабр: 12,
  };
  const wordDate = raw.toLowerCase().match(/(\d{1,2})\s+([а-яё]+)(?:\s+(\d{4}))?/i);
  if (wordDate) {
    const day = Number(wordDate[1]);
    const monthKey = Object.keys(months).find((key) => wordDate[2].startsWith(key));
    if (!monthKey) return null;
    const month = months[monthKey];
    const year = wordDate[3] ? Number(wordDate[3]) : yearHint ?? new Date().getFullYear();
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  return null;
}

function extractPhone(raw: string): string | null {
  const match = raw.match(/(?:\+7|8)\s*[\d\s()-]{9,14}\d/);
  if (!match) return null;
  const digits = match[0].replace(/\D/g, '');
  if (digits.length < 10) return null;
  if (digits.length === 11 && digits.startsWith('8')) return `+7${digits.slice(1)}`;
  if (digits.length === 11 && digits.startsWith('7')) return `+${digits}`;
  if (digits.length === 10) return `+7${digits}`;
  return `+${digits}`;
}

function extractChannel(raw: string): BookingChannel {
  const lower = raw.toLowerCase();
  if (/авито/.test(lower)) return 'avito';
  if (/суточно/.test(lower)) return 'sutochno';
  if (/островок/.test(lower)) return 'ostrovok';
  if (/яндекс/.test(lower)) return 'yandex_travel';
  return 'manual';
}

function extractGuestName(raw: string, phone: string | null): string | null {
  const withoutPhone = phone ? raw.replace(phone, ' ') : raw;
  const explicit = withoutPhone.match(
    /(?:гость|клиент|имя)\s*[:\-]?\s*([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)/i,
  );
  if (explicit) return text(explicit[1]);

  const commaName = withoutPhone.match(/^([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)\s*,/);
  if (commaName) return text(commaName[1]);

  const tokens = withoutPhone
    .split(/[\n,;]+/)
    .map((part) => text(part))
    .filter(Boolean);
  for (const token of tokens) {
    if (/^\+?\d/.test(token)) continue;
    if (/заезд|выезд|авито|суточно|литей|невск/i.test(token)) continue;
    const name = token.match(/^([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)$/);
    if (name) return text(name[1]);
  }
  return null;
}

function extractPropertyLabel(raw: string): string | null {
  const explicit = raw.match(/(?:объект|квартира|адрес)\s*[:\-]?\s*([^\n,;]+)/i);
  if (explicit) return text(explicit[1]);

  const street = raw.match(
    /((?:ул\.?|улица|пр\.?|проспект|пер\.?|переулок|наб\.?|набережная)?\s*[А-ЯЁ][а-яё0-9.\-\s]{2,40}\s*\d{1,4})/i,
  );
  if (street) return text(street[1]);

  const named = raw.match(/([А-ЯЁ][а-яё]+\s+\d{1,4})/);
  if (named) return text(named[1]);
  return null;
}

function resolvePropertyId(
  propertyLabel: string | null,
  properties: PropertyLookup[],
): { propertyId: string | null; propertyLabel: string | null } {
  if (!propertyLabel || properties.length === 0) {
    return { propertyId: null, propertyLabel };
  }
  const needle = propertyLabel.toLowerCase();
  const exact = properties.find(
    (item) => item.label.toLowerCase() === needle || item.propertyId.toLowerCase() === needle,
  );
  if (exact) return { propertyId: exact.propertyId, propertyLabel: exact.label };

  const partial = properties.find((item) => {
    const label = item.label.toLowerCase();
    return label.includes(needle) || needle.includes(label);
  });
  if (partial) return { propertyId: partial.propertyId, propertyLabel: partial.label };

  return { propertyId: null, propertyLabel };
}

function extractDates(raw: string): { checkIn: string | null; checkOut: string | null } {
  const yearHint = new Date().getFullYear();
  const checkInMatch =
    raw.match(/заезд\s*[:\-]?\s*([^\n,;]+)/i)?.[1]
    ?? raw.match(/с\s*([0-9]{1,2}[./][0-9]{1,2}(?:[./][0-9]{2,4})?)/i)?.[1];
  const checkOutMatch =
    raw.match(/выезд\s*[:\-]?\s*([^\n,;]+)/i)?.[1]
    ?? raw.match(/по\s*([0-9]{1,2}[./][0-9]{1,2}(?:[./][0-9]{2,4})?)/i)?.[1];

  const allDates = [...raw.matchAll(/(\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)/g)].map((match) =>
    normalizeRuDateToken(match[1], yearHint),
  ).filter(Boolean) as string[];

  const checkIn = checkInMatch ? normalizeRuDateToken(checkInMatch, yearHint) : allDates[0] ?? null;
  const checkOut = checkOutMatch
    ? normalizeRuDateToken(checkOutMatch, yearHint)
    : allDates.find((date) => date !== checkIn) ?? null;

  return { checkIn, checkOut };
}

function buildReservationRef(input: {
  propertyId: string | null;
  guestName: string | null;
  checkIn: string | null;
  checkOut: string | null;
}): string | null {
  if (!input.propertyId || !input.checkIn || !input.checkOut) return null;
  const guest = text(input.guestName).toLowerCase().replace(/\s+/g, '_') || 'guest';
  return `import:${input.propertyId}:${guest}:${input.checkIn}:${input.checkOut}`;
}

function scoreConfidence(missingFields: string[]): BookingTextImportConfidence {
  if (missingFields.length === 0) return 'high';
  if (missingFields.length <= 2) return 'medium';
  return 'low';
}

export function parseBookingTextImport(input: {
  text: string;
  properties?: PropertyLookup[];
}): BookingTextImportCandidate {
  const raw = text(input.text);
  const phone = extractPhone(raw);
  const guestName = extractGuestName(raw, phone);
  const propertyLabelRaw = extractPropertyLabel(raw);
  const { propertyId, propertyLabel } = resolvePropertyId(propertyLabelRaw, input.properties ?? []);
  const { checkIn, checkOut } = extractDates(raw);
  const channel = extractChannel(raw);

  const missingFields: string[] = [];
  if (!propertyId) missingFields.push('объект');
  if (!guestName) missingFields.push('имя гостя');
  if (!phone) missingFields.push('контакт');
  if (!checkIn) missingFields.push('дата заезда');
  if (!checkOut) missingFields.push('дата выезда');

  const reservationRef = buildReservationRef({ propertyId, guestName, checkIn, checkOut });

  return {
    propertyId,
    propertyLabel,
    guestName,
    guestContact: phone,
    checkIn,
    checkOut,
    channel: normalizeBookingChannel(channel),
    comment: raw.slice(0, 1000) || null,
    confidence: scoreConfidence(missingFields),
    missingFields,
    reservationRef,
  };
}

export function bookingImportSummaryRu(candidate: BookingTextImportCandidate): string {
  const parts = [
    candidate.propertyLabel ? `Объект: ${candidate.propertyLabel}` : 'Объект: не распознан',
    candidate.guestName ? `Гость: ${candidate.guestName}` : 'Гость: не распознан',
    candidate.guestContact ? `Контакт: ${candidate.guestContact}` : 'Контакт: не распознан',
    candidate.checkIn ? `Заезд: ${candidate.checkIn}` : 'Заезд: не распознан',
    candidate.checkOut ? `Выезд: ${candidate.checkOut}` : 'Выезд: не распознан',
    `Канал: ${BOOKING_CHANNEL_LABELS_RU[candidate.channel]}`,
    `Уверенность: ${candidate.confidence}`,
  ];
  return parts.join('\n');
}

export function buildImportReservationRefFallback(): string {
  return `import:${Date.now().toString(36)}:${randomUUID().slice(0, 8)}`;
}
