import type { ProcurementNoticeWorkUnit } from './public-procurement-ingestion';

/** Narrow env bag for tests (mirrors other procurement live layers). */
export type EisOfficialConnectorEnv = Record<string, string | undefined>;

export type EisRequestMode = 'TEST' | 'PROD';

export interface EisOfficialConnectorCredentials {
  readonly pmdToken: string;
  readonly serviceBaseUrl: string;
  readonly requestMode: EisRequestMode;
  readonly organizationInn: string;
  readonly organizationKpp?: string;
}

export interface EisOfficialConnectorResolvedConfig {
  readonly connectorEnabled: boolean;
  /** True when env enables connector but outbound machine credentials are incomplete. */
  readonly outboundBlockedByCredentials: boolean;
  readonly requestMode: EisRequestMode;
  readonly serviceBaseUrl?: string;
  readonly pmdToken?: string;
  readonly organizationInn?: string;
  readonly organizationKpp?: string;
}

export interface SearchNoticesByRegionParams {
  readonly regionCode: string;
  readonly limit?: number;
}

export interface GetDocsByRegistryNumberParams {
  readonly registryNumber: string;
}

export interface GetNoticesByDateRangeParams {
  readonly regionCode: string;
  readonly dateFrom: Date;
  readonly dateTo: Date;
}

export type EisOfficialConnectorOperation =
  | 'searchNoticesByRegion'
  | 'getDocsByRegistryNumber'
  | 'getNoticesByDateRange';

export interface EisDisabledConnectorResult {
  readonly kind: 'disabled';
  readonly outboundHttp: false;
  readonly reason: 'env_flag_off';
}

export interface EisDryRunConnectorResult {
  readonly kind: 'dry_run';
  readonly outboundHttp: false;
  readonly operation: EisOfficialConnectorOperation;
  /** Structural SOAP 1.1 envelope; auth token replaced with a fixed redaction marker. */
  readonly soapEnvelopeRedacted: string;
}

export interface EisConfigConnectorResult {
  readonly kind: 'config_error';
  readonly outboundHttp: false;
  readonly code:
    | 'missing_pmd_token'
    | 'missing_service_base_url'
    | 'missing_organization_inn'
    | 'invalid_request_mode'
    | 'invalid_region_code'
    | 'missing_registry_number'
    | 'invalid_date_range'
    | 'soap_envelope_invalid';
  readonly message: string;
}

export interface EisLiveHttpNotWiredResult {
  readonly kind: 'live_http_not_wired';
  readonly outboundHttp: false;
  readonly operation: EisOfficialConnectorOperation;
}

export type EisOfficialConnectorCallResult =
  | EisDisabledConnectorResult
  | EisDryRunConnectorResult
  | EisConfigConnectorResult
  | EisLiveHttpNotWiredResult;

export interface NormalizeEisDocumentOk {
  readonly ok: true;
  readonly workUnit: ProcurementNoticeWorkUnit;
}

export interface NormalizeEisDocumentErr {
  readonly ok: false;
  readonly message: string;
}

export type NormalizeEisDocumentResult = NormalizeEisDocumentOk | NormalizeEisDocumentErr;
