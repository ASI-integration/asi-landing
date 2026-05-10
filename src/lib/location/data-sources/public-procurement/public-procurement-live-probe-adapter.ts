import type { UrbanDevelopmentAdapter, UrbanDevelopmentCollectInput, UrbanDevelopmentSignal } from '../urban-development';
import type { PublicProcurementIngestionContext } from './public-procurement-ingestion';
import { runPublicProcurementIngestionPipeline } from './public-procurement-ingestion';
import {
  PublicProcurementLiveClient,
  resolvePublicProcurementLiveProbeSourceAccessMode,
  type PublicProcurementLiveProbeEnv,
  type PublicProcurementSourceAccessMode,
} from './public-procurement-live-client';

export {
  isPublicProcurementLiveProbeEnabled,
  PUBLIC_PROCUREMENT_LIVE_PROBE_ENV_KEY,
  PublicProcurementLiveClient,
  resolvePublicProcurementLiveProbeSourceAccessMode,
  type PublicProcurementLiveProbeEnv,
  type PublicProcurementSourceAccessMode,
} from './public-procurement-live-client';

export interface PublicProcurementLiveProbeAdapterOptions {
  readonly client?: PublicProcurementLiveClient;
  readonly enabled?: boolean;
  readonly id?: string;
  readonly label?: string;
  readonly env?: PublicProcurementLiveProbeEnv;
  readonly sampleCacheFixture?: unknown;
  readonly sourceAccessMode?: PublicProcurementSourceAccessMode;
}

/** Keys accepted by {@link createPublicProcurementLiveProbeAdapter} — excludes credential-style inputs by design. */
export const PUBLIC_PROCUREMENT_LIVE_PROBE_ADAPTER_OPTION_KEYS = [
  'client',
  'enabled',
  'id',
  'label',
  'env',
  'sampleCacheFixture',
  'sourceAccessMode',
] as const satisfies readonly (keyof PublicProcurementLiveProbeAdapterOptions)[];

export type PublicProcurementLiveProbeUrbanAdapter = UrbanDevelopmentAdapter & {
  readonly sourceAccessMode: PublicProcurementSourceAccessMode;
};

export function createPublicProcurementLiveProbeAdapter(
  options?: PublicProcurementLiveProbeAdapterOptions,
): PublicProcurementLiveProbeUrbanAdapter {
  const client =
    options?.client
    ?? new PublicProcurementLiveClient({
      env: options?.env,
      sampleCacheFixture: options?.sampleCacheFixture,
    });

  const sourceAccessMode = resolvePublicProcurementLiveProbeSourceAccessMode({
    explicit: options?.sourceAccessMode,
    liveProbeEnabled: client.isLiveProbeEnabled(),
  });

  return {
    id: options?.id ?? 'publicProcurement.liveProbe.sampleCache',
    kind: 'publicProcurement',
    enabled: options?.enabled ?? true,
    label: options?.label ?? 'Public procurement (live probe — sample-cache / manual)',
    sourceAccessMode,
    collect: async (input: UrbanDevelopmentCollectInput): Promise<UrbanDevelopmentSignal[]> => {
      const units = await client.listNoticeWorkUnits(input.regionOrCity);
      const ctx: PublicProcurementIngestionContext = {
        locale: input.locale,
        sourceName: 'public-procurement.liveProbe.sampleCache',
        dataMode: 'live_probe_sample_cache',
      };

      return units.map(unit => runPublicProcurementIngestionPipeline(unit, ctx).signal);
    },
  };
}
