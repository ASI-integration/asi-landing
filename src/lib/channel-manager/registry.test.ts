import { describe, expect, it } from 'vitest';
import {
  CHANNEL_MANAGER_REGISTRY,
  channelManagerDisplayName,
  getChannelManagerById,
  type ChannelConnectorCapabilityStatus,
} from './registry';

describe('channel connector capability contract', () => {
  it('keeps every pilot candidate discovered without claiming verification or external application', () => {
    expect(CHANNEL_MANAGER_REGISTRY).toHaveLength(7);
    for (const entry of CHANNEL_MANAGER_REGISTRY) {
      expect(Object.keys(entry.capabilities).sort()).toEqual(Object.keys(entry.supportedFeatures).sort());
      for (const [feature, capability] of Object.entries(entry.capabilities)) {
        expect(capability).toEqual({ status: 'discovered' });
        expect(entry.supportedFeatures[feature as keyof typeof entry.supportedFeatures]).toBe(false);
      }
      expect(entry.requiresOperator).toBe(true);
      expect(getChannelManagerById(entry.id)).toBe(entry);
      expect(channelManagerDisplayName(entry.id)).toBe(entry.displayName);
    }
  });

  it('prevents mutation of shared discovery states', () => {
    const capabilities = getChannelManagerById('bnovo')!.capabilities;
    expect(Reflect.set(capabilities, 'rates', { status: 'verified' })).toBe(false);
    expect(Reflect.set(capabilities.rates, 'status', 'applied_external')).toBe(false);
    expect(getChannelManagerById('realtycalendar')!.capabilities.rates.status).toBe('discovered');
  });

  it('requires separate verification and property-operation evidence in the status type', () => {
    const verification = { evidenceRef: 'fixture:verification', verifiedAt: '2026-11-15T00:00:00Z' };
    const verified: ChannelConnectorCapabilityStatus = { status: 'verified', verification };
    const applied: ChannelConnectorCapabilityStatus = {
      status: 'applied_external',
      verification,
      externalApplication: {
        evidenceRef: 'fixture:receipt',
        appliedAt: '2026-11-15T00:01:00Z',
        propertyId: 'fixture-property',
        operationId: 'fixture-operation',
      },
    };
    // @ts-expect-error Verification must carry evidence.
    const unverified: ChannelConnectorCapabilityStatus = { status: 'verified' };
    // @ts-expect-error Verification alone cannot prove an external application.
    const unapplied: ChannelConnectorCapabilityStatus = { status: 'applied_external', verification };
    expect(verified.status).toBe('verified');
    expect(applied.externalApplication.operationId).toBe('fixture-operation');
    expect(unverified).not.toHaveProperty('verification');
    expect(unapplied).not.toHaveProperty('externalApplication');
  });

  it('does not invent a connector for an unknown selection', () => {
    expect(getChannelManagerById('missing-provider')).toBeUndefined();
    expect(channelManagerDisplayName('missing-provider')).toBeNull();
    expect(channelManagerDisplayName(undefined)).toBeNull();
  });
});
