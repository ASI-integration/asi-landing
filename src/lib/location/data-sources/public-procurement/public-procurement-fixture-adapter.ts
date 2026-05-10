import type { UrbanDevelopmentAdapter, UrbanDevelopmentCollectInput, UrbanDevelopmentSignal } from '../urban-development';
import { createFixturePublicProcurementGateway } from './fixture-public-procurement-gateway';
import { listAllProcurementGatewayPages } from './public-procurement-gateway';
import type { PublicProcurementFixtureFile } from './fixture-types';
import sampleNoticesFixture from './fixtures/sample-notices.json';
import { runPublicProcurementIngestionPipeline } from './public-procurement-ingestion';

export interface PublicProcurementFixtureAdapterOptions {
  readonly fixture: unknown;
  readonly id?: string;
  readonly label?: string;
  readonly enabled?: boolean;
  /** Stored on signal provenance; defaults to a fixture-oriented catalog label. */
  readonly sourceName?: string;
}

/**
 * Fixture/sample-backed adapter: parses a JSON-shaped payload (e.g. imported fixture file)
 * into {@link UrbanDevelopmentSignal} rows via the procurement gateway + ingestion pipeline.
 */
export function createPublicProcurementFixtureAdapter(options: PublicProcurementFixtureAdapterOptions): UrbanDevelopmentAdapter {
  const gateway = createFixturePublicProcurementGateway({
    fixture: options.fixture,
    sourceName: options.sourceName ?? 'public-procurement.fixture',
  });

  return {
    id: options.id ?? 'publicProcurement.fixture.sample',
    kind: 'publicProcurement',
    enabled: options.enabled ?? true,
    label: options.label ?? 'Public procurement (fixture sample)',
    collect: async (input: UrbanDevelopmentCollectInput) => {
      const bundles = await listAllProcurementGatewayPages(gateway, {
        regionOrCity: input.regionOrCity,
      });

      const out: UrbanDevelopmentSignal[] = [];
      for (const bundle of bundles) {
        const { signal } = runPublicProcurementIngestionPipeline(bundle, {
          locale: input.locale,
          sourceName: gateway.sourceName,
        });
        out.push(signal);
      }
      return out;
    },
  };
}

/** Bundled sample notices for offline tests and demos (no network I/O). */
export function createDefaultSamplePublicProcurementFixtureAdapter(): UrbanDevelopmentAdapter {
  return createPublicProcurementFixtureAdapter({
    fixture: sampleNoticesFixture as unknown,
    id: 'publicProcurement.fixture.sampleNotices',
    label: 'Public procurement (bundled sample notices)',
    sourceName: 'public-procurement.fixture.sampleNotices',
  });
}

export type { PublicProcurementFixtureFile };
