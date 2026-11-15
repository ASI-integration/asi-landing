import { describe, expect, it } from 'vitest';
import { describeAdapterCapability, getAdapterCapabilities, type AdapterCapabilityStatus } from './capabilities';
import { CHANNEL_MANAGER_REGISTRY } from './registry';

const configuration = {
  accountId: 'fixture-account', propertyId: 'fixture-property', configurationRef: 'fixture:config',
};
const verification = { evidenceRef: 'fixture:verification', verifiedAt: '2026-11-15T00:00:00Z' };
const externalApplication = {
  evidenceRef: 'fixture:receipt', appliedAt: '2026-11-15T00:01:00Z',
  propertyId: 'fixture-property', operationId: 'fixture-operation',
};

describe('read-only adapter capabilities', () => {
  it('keeps every pilot candidate discovered regardless of API/selection metadata', () => {
    for (const connector of CHANNEL_MANAGER_REGISTRY) {
      const snapshot = getAdapterCapabilities(connector.id)!;
      expect(snapshot.mode).toBe('read_only');
      expect(snapshot.synchronization).toBe('not_asserted');
      expect(snapshot.providerInvocationAllowed).toBe(false);
      expect(Object.keys(snapshot.capabilities).sort()).toEqual(Object.keys(connector.supportedFeatures).sort());
      for (const capability of Object.values(snapshot.capabilities)) {
        expect(capability).toEqual({ status: 'discovered' });
      }
    }
  });

  it('configures only the specified feature without claiming verification or application', () => {
    const snapshot = getAdapterCapabilities('bnovo', { rates: configuration })!;
    expect(snapshot.capabilities.rates).toEqual({ status: 'configured', configuration });
    expect(snapshot.capabilities.availability).toEqual({ status: 'discovered' });
    expect(snapshot.capabilities.rates).not.toHaveProperty('verification');
    expect(snapshot.capabilities.rates).not.toHaveProperty('externalApplication');
    expect(getAdapterCapabilities('bnovo')!.capabilities.rates.status).toBe('discovered');
    expect(getAdapterCapabilities('realtycalendar')!.capabilities.rates.status).toBe('discovered');
  });

  it('preserves verification without treating it as external application', () => {
    expect(describeAdapterCapability({ status: 'verified', verification }, configuration))
      .toEqual({ status: 'verified', verification });
  });

  it('preserves a separately recorded application and its property-operation identity', () => {
    expect(describeAdapterCapability({ status: 'applied_external', verification, externalApplication }))
      .toEqual({ status: 'applied_external', verification, externalApplication });
  });

  it('returns immutable detached snapshots without mutating supplied metadata', () => {
    const input = { ...configuration };
    const snapshot = getAdapterCapabilities('bnovo', { rates: input })!;
    input.propertyId = 'changed';
    expect(snapshot.capabilities.rates).toEqual({ status: 'configured', configuration });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.capabilities)).toBe(true);
    expect(Object.isFrozen(snapshot.capabilities.rates)).toBe(true);
    const applied = describeAdapterCapability({ status: 'applied_external', verification, externalApplication });
    expect(Object.isFrozen(applied)).toBe(true);
    if (applied.status === 'applied_external') {
      expect(Object.isFrozen(applied.verification)).toBe(true);
      expect(Object.isFrozen(applied.externalApplication)).toBe(true);
      expect(applied.externalApplication).not.toBe(externalApplication);
    }
  });

  it.each(['accountId', 'propertyId', 'configurationRef'] as const)('rejects blank %s metadata', (field) => {
    expect(() => getAdapterCapabilities('bnovo', { rates: { ...configuration, [field]: ' ' } })).toThrow();
  });

  it('does not invent unknown connectors', () => {
    expect(getAdapterCapabilities('missing-provider', { rates: configuration })).toBeUndefined();
  });

  it('produces deterministic results using only the supplied offline records', () => {
    expect(getAdapterCapabilities('bnovo', { rates: configuration }))
      .toEqual(getAdapterCapabilities('bnovo', { rates: configuration }));
  });

  it('requires evidence for verified/applied and metadata for configured states', () => {
    // @ts-expect-error Configuration is not verification evidence.
    const verified: AdapterCapabilityStatus = { status: 'verified', configuration };
    // @ts-expect-error Verification does not prove an external operation.
    const applied: AdapterCapabilityStatus = { status: 'applied_external', verification };
    // @ts-expect-error Configuration requires explicit metadata.
    const configured: AdapterCapabilityStatus = { status: 'configured' };
    expect([verified, applied, configured]).toHaveLength(3);
  });
});
