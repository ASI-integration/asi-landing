import type { AdapterFeature } from './capabilities';

export type ProviderEvidenceScope = Readonly<{
  connectorId: string;
  accountId: string;
  propertyId: string;
  feature: AdapterFeature;
  operationId: string;
}>;

/** Supplied receipt metadata only; never credentials, clients or live verification. */
export type ProviderEvidenceReceipt = Readonly<{
  scope: ProviderEvidenceScope;
  evidenceRef: string;
  recordedAt: string;
}>;

export type ProviderEvidenceState = 'unverified' | 'stale' | 'mismatched_scope' | 'receipted';

export type ProviderEvidenceClassification = Readonly<{
  state: ProviderEvidenceState;
  mode: 'read_only';
  synchronization: 'not_asserted';
  providerInvocationAllowed: false;
}>;

const scopeKeys = ['connectorId', 'accountId', 'propertyId', 'feature', 'operationId'] as const;
const features: readonly AdapterFeature[] = ['propertyExport', 'rates', 'availability', 'bookingsImport', 'messages'];
const nonblank = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const validScope = (scope: ProviderEvidenceScope): boolean =>
  !!scope && scopeKeys.every((key) => nonblank(scope[key])) && features.includes(scope.feature);

/**
 * Pure offline classification, with an explicit clock and freshness budget (milliseconds).
 * A receipt records supplied evidence for one exact operation, not provider authenticity,
 * ongoing connectivity, synchronization, or permission to send. Invalid/future evidence
 * fails closed. Scope mismatch takes precedence over age; the age boundary is inclusive.
 */
export function classifyProviderEvidence(input: Readonly<{
  scope: ProviderEvidenceScope;
  receipt?: ProviderEvidenceReceipt | null;
  nowMs: number;
  maxAgeMs: number;
}>): ProviderEvidenceClassification {
  const result = (state: ProviderEvidenceState): ProviderEvidenceClassification => Object.freeze({
    state, mode: 'read_only', synchronization: 'not_asserted', providerInvocationAllowed: false,
  });
  const { scope, receipt, nowMs, maxAgeMs } = input;
  if (!validScope(scope) || !Number.isFinite(nowMs) || !Number.isFinite(maxAgeMs) || maxAgeMs < 0
    || !receipt || !validScope(receipt.scope) || !nonblank(receipt.evidenceRef)
    || !nonblank(receipt.recordedAt)) return result('unverified');

  // Require a full ISO timestamp with an explicit timezone, never a local date.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(receipt.recordedAt)) {
    return result('unverified');
  }
  const year = Number(receipt.recordedAt.slice(0, 4));
  const month = Number(receipt.recordedAt.slice(5, 7));
  const day = Number(receipt.recordedAt.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]
    || Number(receipt.recordedAt.slice(11, 13)) > 23) return result('unverified');
  const recordedMs = Date.parse(receipt.recordedAt);
  if (!Number.isFinite(recordedMs) || recordedMs > nowMs) return result('unverified');
  if (scopeKeys.some((key) => scope[key] !== receipt.scope[key])) return result('mismatched_scope');
  return result(nowMs - recordedMs > maxAgeMs ? 'stale' : 'receipted');
}
