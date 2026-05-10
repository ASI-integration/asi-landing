import { parsePublicProcurementFixtureWithAudit } from './fixture-types';
import type { ProcurementNoticeWorkUnit } from './public-procurement-ingestion';
import { validatePublicProcurementRawNoticePayload } from './public-procurement-ingestion';
import { regionMatchesProcurementGateway } from './public-procurement-gateway';
import liveProbeSampleCache from './fixtures/public-procurement-live-probe-sample-cache.json';

/** Narrow env bag for tests and SSR overrides (no full `ProcessEnv` required). */
export type PublicProcurementLiveProbeEnv = Record<string, string | undefined>;

/**
 * Reads {@link PUBLIC_PROCUREMENT_LIVE_PROBE_ENV_KEY}.
 * Default is off; no outbound HTTP is implied by returning false.
 */
export function isPublicProcurementLiveProbeEnabled(
  env: PublicProcurementLiveProbeEnv | undefined = typeof process !== 'undefined' ? process.env : undefined,
): boolean {
  const raw = env?.PUBLIC_PROCUREMENT_LIVE_PROBE_ENABLED;
  if (raw === undefined || raw === '') return false;
  const v = String(raw).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export const PUBLIC_PROCUREMENT_LIVE_PROBE_ENV_KEY = 'PUBLIC_PROCUREMENT_LIVE_PROBE_ENABLED' as const;

export interface PublicProcurementLiveClientOptions {
  /** For tests or SSR callers that must not read global `process.env`. */
  readonly env?: PublicProcurementLiveProbeEnv;
  /** Replace bundled sample-cache JSON (offline catalog). */
  readonly sampleCacheFixture?: unknown;
}

/**
 * Safe procurement “live probe” facade: offline sample-cache while the probe flag is off;
 * when the flag is on, upstream HTTP is intentionally not wired yet (returns no notices).
 */
export class PublicProcurementLiveClient {
  private readonly env?: PublicProcurementLiveProbeEnv;
  private readonly sampleCacheFixture: unknown;

  constructor(options?: PublicProcurementLiveClientOptions) {
    this.env = options?.env;
    this.sampleCacheFixture = options?.sampleCacheFixture ?? liveProbeSampleCache;
  }

  isLiveProbeEnabled(): boolean {
    const env = this.env ?? (typeof process !== 'undefined' ? process.env : undefined);
    return isPublicProcurementLiveProbeEnabled(env);
  }

  /**
   * Lists notices as pipeline work units (validated + raw payload for audit-only use).
   */
  async listNoticeWorkUnits(regionOrCity: string): Promise<readonly ProcurementNoticeWorkUnit[]> {
    if (this.isLiveProbeEnabled()) {
      return [];
    }

    const parsed = parsePublicProcurementFixtureWithAudit(this.sampleCacheFixture);
    const out: ProcurementNoticeWorkUnit[] = [];
    for (const row of parsed.notices) {
      if (!regionMatchesProcurementGateway(regionOrCity, row.validated.regionHint)) continue;
      out.push(validatePublicProcurementRawNoticePayload(row.rawPayload));
    }
    return out;
  }
}
