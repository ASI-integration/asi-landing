import { parsePublicProcurementFixtureWithAudit, type PublicProcurementFixtureParsedNotice } from './fixture-types';
import {
  clampProcurementGatewayLimit,
  decodeProcurementGatewayOffsetCursor,
  encodeProcurementGatewayOffsetCursor,
  PUBLIC_PROCUREMENT_GATEWAY_DEFAULT_PAGE_LIMIT,
  regionMatchesProcurementGateway,
} from './public-procurement-gateway';
import type {
  PublicProcurementGateway,
  PublicProcurementGatewayListPage,
  PublicProcurementGatewayNoticeBundle,
  PublicProcurementGatewayQuery,
} from './public-procurement-gateway-types';

export interface FixturePublicProcurementGatewayOptions {
  readonly fixture: unknown;
  /** Declared catalog label for provenance (e.g. bundled sample vs future API id). */
  readonly sourceName?: string;
  readonly defaultPageLimit?: number;
}

export function createFixturePublicProcurementGateway(options: FixturePublicProcurementGatewayOptions): PublicProcurementGateway {
  const parsed = parsePublicProcurementFixtureWithAudit(options.fixture);
  const sourceName = options.sourceName ?? 'fixture-public-procurement';
  const fallbackLimit = options.defaultPageLimit ?? PUBLIC_PROCUREMENT_GATEWAY_DEFAULT_PAGE_LIMIT;

  const bundlesForRegion = (regionOrCity: string): readonly PublicProcurementFixtureParsedNotice[] =>
    parsed.notices.filter(p => regionMatchesProcurementGateway(regionOrCity, p.validated.regionHint));

  return {
    sourceName,
    async listNotices(query: PublicProcurementGatewayQuery): Promise<PublicProcurementGatewayListPage> {
      const matching = bundlesForRegion(query.regionOrCity);
      const limit = clampProcurementGatewayLimit(query.pagination?.limit, fallbackLimit);
      const offset = decodeProcurementGatewayOffsetCursor(query.pagination?.cursor);
      const slice = matching.slice(offset, offset + limit);
      const items: PublicProcurementGatewayNoticeBundle[] = slice.map(p => ({
        validated: p.validated,
        rawPayload: p.rawPayload,
      }));
      const nextOffset = offset + slice.length;
      const hasMore = nextOffset < matching.length;
      return {
        items,
        nextCursor: hasMore ? encodeProcurementGatewayOffsetCursor(nextOffset) : undefined,
        hasMore,
      };
    },
  };
}
