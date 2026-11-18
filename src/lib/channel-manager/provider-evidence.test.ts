import { describe, expect, it } from 'vitest';
import { classifyProviderEvidence, type ProviderEvidenceReceipt, type ProviderEvidenceScope } from './provider-evidence';

const scope: ProviderEvidenceScope = {
  connectorId: 'bnovo', accountId: 'fixture-account', propertyId: 'fixture-property',
  feature: 'rates', operationId: 'fixture-operation',
};
const nowMs = Date.parse('2026-11-15T12:00:00Z');
const receipt: ProviderEvidenceReceipt = { scope, evidenceRef: 'fixture:receipt', recordedAt: '2026-11-15T11:59:00Z' };
const input = { scope, receipt, nowMs, maxAgeMs: 60_000 };

describe('offline provider evidence', () => {
  it('keeps missing receipts unverified', () => {
    expect(classifyProviderEvidence({ ...input, receipt: undefined }).state).toBe('unverified');
    expect(classifyProviderEvidence({ ...input, receipt: null }).state).toBe('unverified');
  });

  it('accepts an exact fresh receipt at the inclusive freshness boundary', () => {
    expect(classifyProviderEvidence(input).state).toBe('receipted');
    expect(classifyProviderEvidence({ ...input, nowMs: nowMs + 1 }).state).toBe('stale');
    expect(classifyProviderEvidence({ ...input, maxAgeMs: 0, nowMs: nowMs - 60_000 }).state).toBe('receipted');
  });

  it.each(['connectorId', 'accountId', 'propertyId', 'feature', 'operationId'] as const)(
    'isolates %s and prioritizes mismatched scope over staleness', (key) => {
      const otherScope = { ...scope, [key]: key === 'feature' ? 'availability' : 'other' };
      expect(classifyProviderEvidence({ ...input, maxAgeMs: 0, receipt: { ...receipt, scope: otherScope } }).state)
        .toBe('mismatched_scope');
    },
  );

  it.each(['', ' ', 'invalid', '2026-11-15', '2026-11-15T11:59:00', '2026-11-15T12:00:01Z',
    '2026-02-30T00:00:00Z', '2026-11-14T24:00:00Z'])(
    'fails closed for invalid or future timestamp %s', (recordedAt) => {
      expect(classifyProviderEvidence({ ...input, receipt: { ...receipt, recordedAt } }).state).toBe('unverified');
    },
  );

  it.each([NaN, Infinity, -1])('rejects invalid freshness budget %s', (maxAgeMs) => {
    expect(classifyProviderEvidence({ ...input, maxAgeMs }).state).toBe('unverified');
  });

  it('rejects incomplete evidence and scope without treating configuration as proof', () => {
    expect(classifyProviderEvidence({ ...input, receipt: { ...receipt, evidenceRef: ' ' } }).state).toBe('unverified');
    for (const key of ['connectorId', 'accountId', 'propertyId', 'feature', 'operationId'] as const) {
      expect(classifyProviderEvidence({ ...input, scope: { ...scope, [key]: '' } }).state).toBe('unverified');
      expect(classifyProviderEvidence({ ...input, receipt: { ...receipt, scope: { ...scope, [key]: '' } } }).state)
        .toBe('unverified');
    }
    expect(classifyProviderEvidence({ ...input, nowMs: NaN }).state).toBe('unverified');
  });

  it('is deterministic, immutable and never grants provider invocation in any state', () => {
    const before = JSON.stringify(input);
    const cases = [input, { ...input, receipt: null }, { ...input, maxAgeMs: 0 },
      { ...input, scope: { ...scope, accountId: 'other' } }];
    for (const candidate of cases) {
      const result = classifyProviderEvidence(candidate);
      expect(result).toEqual(classifyProviderEvidence(candidate));
      expect(result).toMatchObject({ mode: 'read_only', synchronization: 'not_asserted', providerInvocationAllowed: false });
      expect(Object.isFrozen(result)).toBe(true);
    }
    expect(JSON.stringify(input)).toBe(before);
  });
});
