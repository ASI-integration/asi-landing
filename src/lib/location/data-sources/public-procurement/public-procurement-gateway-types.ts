import type { PublicProcurementNoticeInput } from './classify-notice';

/** Pagination cursor opaque to callers — implementations encode offsets or opaque tokens. */
export type PublicProcurementGatewayCursor = string;

export interface PublicProcurementGatewayPagination {
  readonly cursor?: PublicProcurementGatewayCursor;
  /** Maximum items per page; gateways clamp to a reasonable upper bound. */
  readonly limit?: number;
}

export interface PublicProcurementGatewayQuery {
  readonly regionOrCity: string;
  readonly pagination?: PublicProcurementGatewayPagination;
}

/**
 * Validated procurement notice paired with an upstream payload preserved for audit only.
 * `rawPayload` must never be copied onto {@link UrbanDevelopmentSignal}.
 */
export interface PublicProcurementGatewayNoticeBundle {
  readonly validated: PublicProcurementNoticeInput;
  readonly rawPayload: unknown;
}

/** Single page from an eventual HTTP/API search — fixture implementations mimic slicing only. */
export interface PublicProcurementGatewayListPage {
  readonly items: readonly PublicProcurementGatewayNoticeBundle[];
  readonly nextCursor?: PublicProcurementGatewayCursor;
  readonly hasMore: boolean;
}

/**
 * Future-facing façade over procurement catalogs (fixtures today, HTTP/API later).
 * Implementations perform regional filtering only; no live network I/O is implied here.
 */
export interface PublicProcurementGateway {
  readonly sourceName: string;
  listNotices(query: PublicProcurementGatewayQuery): Promise<PublicProcurementGatewayListPage>;
}
