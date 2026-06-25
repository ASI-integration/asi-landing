import { PILOT_ACCEPTANCE_PREFIX } from '@/lib/pilot-readiness/types';
import { TELEGRAM_OPS_ACCEPTANCE_PREFIX } from '@/lib/communication/telegram-ops-acceptance-shared';

export const PILOT_CHAIN_ACCEPTANCE_PREFIX = 'ASI_PILOT_CHAIN_ACCEPTANCE_';

export const TEST_DATA_MARKER_PREFIXES = [
  PILOT_ACCEPTANCE_PREFIX,
  TELEGRAM_OPS_ACCEPTANCE_PREFIX,
  PILOT_CHAIN_ACCEPTANCE_PREFIX,
  'ASI_OPS_ACCEPTANCE_',
  'ASI_COMM_OPS_ACCEPTANCE_',
  'pilot_accept_',
] as const;

export const TEST_DATA_MARKER_TAGS = ['acceptance', 'pilot_accept', 'synthetic', 'test'] as const;

export function text(value: unknown): string {
  return String(value ?? '').trim();
}

export function matchesTestOrAcceptanceMarker(value: string | null | undefined): boolean {
  const haystack = text(value).toLowerCase();
  if (!haystack) return false;
  if (TEST_DATA_MARKER_PREFIXES.some((marker) => haystack.includes(marker.toLowerCase()))) {
    return true;
  }
  return TEST_DATA_MARKER_TAGS.some((tag) => haystack.includes(tag));
}

export function isPilotAcceptanceProperty(input: {
  propertyId?: string | null;
  pilotAcceptanceMarker?: string | null;
}): boolean {
  return (
    matchesTestOrAcceptanceMarker(input.pilotAcceptanceMarker)
    || matchesTestOrAcceptanceMarker(input.propertyId)
  );
}

export function isPilotAcceptanceBooking(input: {
  propertyId?: string | null;
  reservationRef?: string | null;
  comment?: string | null;
  pilotAcceptanceMarker?: string | null;
}): boolean {
  return (
    matchesTestOrAcceptanceMarker(input.pilotAcceptanceMarker)
    || matchesTestOrAcceptanceMarker(input.reservationRef)
    || matchesTestOrAcceptanceMarker(input.comment)
    || matchesTestOrAcceptanceMarker(input.propertyId)
  );
}

export function isSyntheticOpsTask(input: {
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  dedupKey?: string | null;
}): boolean {
  const metadataHaystack = JSON.stringify(input.metadata ?? {});
  const haystack = [input.description, metadataHaystack, input.dedupKey].map(text).join('\n').toLowerCase();
  if (!haystack) return false;
  if (matchesTestOrAcceptanceMarker(haystack)) return true;
  if (haystack.includes('"synthetic_inbound":true') || haystack.includes('synthetic_inbound')) return true;
  return false;
}

export function looksLikeTechnicalPropertyId(value: string): boolean {
  const id = text(value);
  if (!id) return true;
  if (/^pilot_accept_/i.test(id)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return true;
  if (/^pilot_[a-z0-9а-я_-]+_[a-z0-9]+$/i.test(id)) return true;
  return false;
}
