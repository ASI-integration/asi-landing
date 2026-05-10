import type {
  PublicProcurementGateway,
  PublicProcurementGatewayListPage,
  PublicProcurementGatewayNoticeBundle,
  PublicProcurementGatewayQuery,
} from './public-procurement-gateway-types';

export type { PublicProcurementGateway } from './public-procurement-gateway-types';

export function regionMatchesProcurementGateway(regionOrCity: string, noticeRegionHint?: string): boolean {
  const r = regionOrCity.trim().toLowerCase();
  if (!r) return true;
  const h = noticeRegionHint?.trim().toLowerCase();
  if (!h) return true;
  return r.includes(h) || h.includes(r);
}

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 500;

export function clampProcurementGatewayLimit(limit: number | undefined, fallback: number): number {
  const raw = limit ?? fallback;
  return Math.min(Math.max(raw, 1), MAX_PAGE_LIMIT);
}

export function encodeProcurementGatewayOffsetCursor(offset: number): string {
  return `off:${offset}`;
}

export function decodeProcurementGatewayOffsetCursor(cursor: string | undefined): number {
  if (!cursor?.trim()) return 0;
  const m = /^off:(\d+)$/.exec(cursor.trim());
  if (!m) return 0;
  return Number(m[1]);
}

/**
 * Iterates every page from a gateway until `hasMore` is false (fixture-sized workloads only).
 */
export async function listAllProcurementGatewayPages(
  gateway: PublicProcurementGateway,
  query: Omit<PublicProcurementGatewayQuery, 'pagination'>,
  opts?: { readonly pageLimit?: number },
): Promise<readonly PublicProcurementGatewayNoticeBundle[]> {
  const limit = clampProcurementGatewayLimit(opts?.pageLimit, DEFAULT_PAGE_LIMIT);
  const out: PublicProcurementGatewayNoticeBundle[] = [];
  let cursor: string | undefined;
  let hasMore = true;
  while (hasMore) {
    const page = await gateway.listNotices({
      ...query,
      pagination: { cursor, limit },
    });
    out.push(...page.items);
    cursor = page.nextCursor;
    hasMore = page.hasMore;
  }
  return out;
}

export const PUBLIC_PROCUREMENT_GATEWAY_DEFAULT_PAGE_LIMIT = DEFAULT_PAGE_LIMIT;
