import {
  getChannelManagerById,
  type ChannelConnectorCapabilityStatus,
  type ChannelManagerSupportedFeatures,
} from './registry';

export type AdapterFeature = keyof ChannelManagerSupportedFeatures;

/** Metadata only: never pass credentials or provider clients to this module. */
export type AdapterConfiguration = Readonly<{
  accountId: string;
  propertyId: string;
  configurationRef: string;
}>;

export type AdapterCapabilityStatus =
  | Readonly<ChannelConnectorCapabilityStatus>
  | Readonly<{ status: 'configured'; configuration: AdapterConfiguration }>;

export type AdapterCapabilitySnapshot = Readonly<{
  connectorId: string;
  mode: 'read_only';
  synchronization: 'not_asserted';
  providerInvocationAllowed: false;
  capabilities: Readonly<Record<AdapterFeature, AdapterCapabilityStatus>>;
}>;

/**
 * Projects supplied evidence; does not verify it or perform an operation.
 * applied_external describes a recorded operation, never ongoing synchronization
 * or permission to invoke a provider. Configuration alone proves neither.
 */
export function describeAdapterCapability(
  capability: ChannelConnectorCapabilityStatus,
  configuration?: AdapterConfiguration,
): AdapterCapabilityStatus {
  switch (capability.status) {
    case 'discovered':
      if (!configuration) return Object.freeze({ status: 'discovered' });
      if (![configuration.accountId, configuration.propertyId, configuration.configurationRef]
        .every((value) => typeof value === 'string' && value.trim().length > 0)) {
        throw new Error('Adapter configuration requires account, property and reference metadata');
      }
      return Object.freeze({
        status: 'configured',
        configuration: Object.freeze({
          accountId: configuration.accountId,
          propertyId: configuration.propertyId,
          configurationRef: configuration.configurationRef,
        }),
      });
    case 'verified':
      return Object.freeze({
        status: 'verified',
        verification: Object.freeze({ ...capability.verification }),
      });
    case 'applied_external':
      return Object.freeze({
        status: 'applied_external',
        verification: Object.freeze({ ...capability.verification }),
        externalApplication: Object.freeze({ ...capability.externalApplication }),
      });
  }
}

/** Unknown connectors stay unknown. Selection/API metadata never proves support. */
export function getAdapterCapabilities(
  connectorId: string,
  configuration: Readonly<Partial<Record<AdapterFeature, AdapterConfiguration>>> = {},
): AdapterCapabilitySnapshot | undefined {
  const connector = getChannelManagerById(connectorId);
  if (!connector) return undefined;
  const capabilities = {} as Record<AdapterFeature, AdapterCapabilityStatus>;
  for (const feature of Object.keys(connector.capabilities) as AdapterFeature[]) {
    capabilities[feature] = describeAdapterCapability(connector.capabilities[feature], configuration[feature]);
  }
  return Object.freeze({
    connectorId: connector.id,
    mode: 'read_only',
    synchronization: 'not_asserted',
    providerInvocationAllowed: false,
    capabilities: Object.freeze(capabilities),
  });
}
