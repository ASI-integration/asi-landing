import type { UrbanDevelopmentAdapter, UrbanDevelopmentCollectInput, UrbanDevelopmentSignal } from '../urban-development';
import type { PublicProcurementIngestionContext } from './public-procurement-ingestion';
import { runPublicProcurementIngestionPipeline } from './public-procurement-ingestion';
import { PublicProcurementLiveClient, type PublicProcurementLiveProbeEnv } from './public-procurement-live-client';

export {
  isPublicProcurementLiveProbeEnabled,
  PUBLIC_PROCUREMENT_LIVE_PROBE_ENV_KEY,
  PublicProcurementLiveClient,
  type PublicProcurementLiveProbeEnv,
} from './public-procurement-live-client';

export interface PublicProcurementLiveProbeAdapterOptions {
  readonly client?: PublicProcurementLiveClient;
  readonly enabled?: boolean;
  readonly id?: string;
  readonly label?: string;
  readonly env?: PublicProcurementLiveProbeEnv;
  readonly sampleCacheFixture?: unknown;
}

export function createPublicProcurementLiveProbeAdapter(options?: PublicProcurementLiveProbeAdapterOptions): UrbanDevelopmentAdapter {
  const client =
    options?.client
    ?? new PublicProcurementLiveClient({
      env: options?.env,
      sampleCacheFixture: options?.sampleCacheFixture,
    });

  return {
    id: options?.id ?? 'publicProcurement.liveProbe.sampleCache',
    kind: 'publicProcurement',
    enabled: options?.enabled ?? true,
    label: options?.label ?? 'Public procurement (live probe — sample-cache / manual)',
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
