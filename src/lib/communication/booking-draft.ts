import { BookingDraft } from './types';

const SPECIFIC_REQUEST_PATTERNS: Array<{ key: string; patterns: RegExp[] }> = [
  {
    key: 'parking',
    patterns: [/\bparking\b/i, /\bgarage\b/i, /парковк/i, /паркинг/i, /машин[аы]\b/i],
  },
  {
    key: 'extra_bed',
    patterns: [/extra bed/i, /baby cot/i, /crib/i, /доп\.?\s*кроват/i, /детск[а-я]+\s+кроват/i],
  },
  {
    key: 'pets',
    patterns: [/\bpet(?:s)?\b/i, /animal/i, /животн/i, /собак/i, /кошк/i],
  },
];

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function extractPropertyLabel(text: string): string | undefined {
  const addressMatch = text.match(/(?:^|\s(?:на|по)\s)([А-ЯЁA-Z][А-ЯЁA-Zа-яёa-z.-]+(?:\s+[А-ЯЁA-Zа-яёa-z.-]+){0,3},\s*\d+[\w/-]*)/u);
  if (addressMatch?.[1]) {
    const normalized = normalizeWhitespace(addressMatch[1]);
    return normalized.split(/\s(?:на|по|at|for)\s/iu).pop()?.trim() ?? normalized;
  }

  const listingMatch = text.match(/(?:апартамент(?:ы)?|квартира|объект|apartment|property|unit)\s+([A-ZА-ЯЁ0-9][\w\s-]{0,40})/iu);
  if (listingMatch?.[1]) {
    return normalizeWhitespace(listingMatch[1]);
  }

  return undefined;
}

function extractStayNights(text: string): number | undefined {
  const nightsMatch = text.match(/(\d{1,2})\s*(?:ноч(?:ь|и|ей)|ночки|nights?)/iu);
  if (!nightsMatch) return undefined;

  const nights = Number.parseInt(nightsMatch[1], 10);
  return Number.isFinite(nights) ? nights : undefined;
}

function extractGuestName(text: string): string | undefined {
  const patterns = [
    /(?:имя гостя|гость|на имя)\s*[:\-]?\s*([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+){0,2})(?=[,.;!?]|$)/iu,
    /(?:guest name|guest is|name is|for)\s*[:\-]?\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})(?=[,.;!?]|$)/u,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return normalizeWhitespace(match[1]);
    }
  }

  return undefined;
}

function extractSpecificRequests(text: string): string[] | undefined {
  const requests = SPECIFIC_REQUEST_PATTERNS
    .filter(({ patterns }) => patterns.some((pattern) => pattern.test(text)))
    .map(({ key }) => key);

  return requests.length > 0 ? requests : undefined;
}

export function extractBookingDraft(text: string): Partial<BookingDraft> {
  return {
    propertyLabel: extractPropertyLabel(text),
    stayNights: extractStayNights(text),
    guestName: extractGuestName(text),
    specificRequests: extractSpecificRequests(text),
  };
}