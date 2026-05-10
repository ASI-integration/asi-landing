import {
  EIS_OFFICIAL_MAX_DATE_RANGE_DAYS,
  EIS_AUTH_TOKEN_REDACTION,
  resolveEisOfficialConnectorConfig,
  parseEisRequestMode,
  readTrimmedEnv,
  EIS_REQUEST_MODE_ENV_KEY,
} from './eis-official-config';
import {
  buildGetDocsByOrgRegionRequest,
  buildGetDocsByReestrNumberRequest,
  redactPmdTokenFromSoapEnvelope,
  validateSoapEnvelopeStructure,
} from './eis-official-soap-builder';
import type {
  EisOfficialConnectorCallResult,
  EisOfficialConnectorEnv,
  GetDocsByRegistryNumberParams,
  GetNoticesByDateRangeParams,
  NormalizeEisDocumentResult,
  SearchNoticesByRegionParams,
} from './eis-official-types';
import { validatePublicProcurementRawNoticePayload } from './public-procurement-ingestion';

function cloneUtcDate(d: Date): Date {
  return new Date(d.getTime());
}

/**
 * Clamps an inclusive [from, to] window to a safe maximum length in UTC calendar days.
 */
export function clampNoticesDateRangeUtc(dateFrom: Date, dateTo: Date): { dateFrom: Date; dateTo: Date; clamped: boolean } {
  const from = cloneUtcDate(dateFrom);
  const to = cloneUtcDate(dateTo);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return { dateFrom: from, dateTo: to, clamped: false };
  if (from > to) return { dateFrom: to, dateTo: from, clamped: true };

  const maxMs = EIS_OFFICIAL_MAX_DATE_RANGE_DAYS * 24 * 60 * 60 * 1000;
  const span = to.getTime() - from.getTime();
  if (span <= maxMs) return { dateFrom: from, dateTo: to, clamped: false };

  const clampedTo = new Date(from.getTime() + maxMs);
  return { dateFrom: from, dateTo: clampedTo, clamped: true };
}

export interface EisOfficialConnectorOptions {
  readonly env?: EisOfficialConnectorEnv;
}

export class EisOfficialConnector {
  private readonly env?: EisOfficialConnectorEnv;

  constructor(options?: EisOfficialConnectorOptions) {
    this.env = options?.env;
  }

  private bag(): EisOfficialConnectorEnv | undefined {
    return this.env ?? (typeof process !== 'undefined' ? process.env : undefined);
  }

  /** SOAP skeleton shared by region search and date-range listing (same upstream shape). */
  searchNoticesByRegion(params: SearchNoticesByRegionParams, options?: { readonly dryRun?: boolean }): EisOfficialConnectorCallResult {
    return this.runOrgRegionEnvelope('searchNoticesByRegion', params.regionCode, params.limit, options?.dryRun === true);
  }

  getDocsByRegistryNumber(params: GetDocsByRegistryNumberParams, options?: { readonly dryRun?: boolean }): EisOfficialConnectorCallResult {
    const cfg = resolveEisOfficialConnectorConfig(this.bag());
    if (!cfg.connectorEnabled) return { kind: 'disabled', outboundHttp: false, reason: 'env_flag_off' };

    const registryNumber = params.registryNumber?.trim() ?? '';
    if (!registryNumber) {
      return {
        kind: 'config_error',
        outboundHttp: false,
        code: 'missing_registry_number',
        message: 'Registry number is required.',
      };
    }

    const dryRun = options?.dryRun === true;
    const authToken = cfg.pmdToken ?? EIS_AUTH_TOKEN_REDACTION;
    const mode = cfg.pmdToken ? cfg.requestMode : parseEisRequestMode(readTrimmedEnv(this.bag(), EIS_REQUEST_MODE_ENV_KEY)) ?? 'TEST';

    if (dryRun) {
      const soap = buildGetDocsByReestrNumberRequest({
        authToken,
        requestMode: mode,
        registryNumber,
      });
      if (!validateSoapEnvelopeStructure(soap)) {
        return {
          kind: 'config_error',
          outboundHttp: false,
          code: 'soap_envelope_invalid',
          message: 'SOAP envelope validation failed.',
        };
      }
      const redacted = cfg.pmdToken ? redactPmdTokenFromSoapEnvelope(soap, cfg.pmdToken) : redactPmdTokenFromSoapEnvelope(soap, authToken);
      return { kind: 'dry_run', outboundHttp: false, operation: 'getDocsByRegistryNumber', soapEnvelopeRedacted: redacted };
    }

    if (cfg.outboundBlockedByCredentials) {
      return this.missingCredentialResult(cfg);
    }

    return { kind: 'live_http_not_wired', outboundHttp: false, operation: 'getDocsByRegistryNumber' };
  }

  getNoticesByDateRange(params: GetNoticesByDateRangeParams, options?: { readonly dryRun?: boolean }): EisOfficialConnectorCallResult {
    const { dateFrom, dateTo } = clampNoticesDateRangeUtc(params.dateFrom, params.dateTo);
    return this.runOrgRegionEnvelope(
      'getNoticesByDateRange',
      params.regionCode,
      undefined,
      options?.dryRun === true,
      dateFrom,
      dateTo,
    );
  }

  private missingCredentialResult(cfg: ReturnType<typeof resolveEisOfficialConnectorConfig>): EisOfficialConnectorCallResult {
    const rawMode = readTrimmedEnv(this.bag(), EIS_REQUEST_MODE_ENV_KEY);
    if (!rawMode || !parseEisRequestMode(rawMode)) {
      return {
        kind: 'config_error',
        outboundHttp: false,
        code: 'invalid_request_mode',
        message: 'EIS_REQUEST_MODE must be TEST or PROD.',
      };
    }
    if (!cfg.serviceBaseUrl?.trim()) {
      return { kind: 'config_error', outboundHttp: false, code: 'missing_service_base_url', message: 'EIS_SERVICE_BASE_URL is required.' };
    }
    if (!cfg.pmdToken?.trim()) {
      return { kind: 'config_error', outboundHttp: false, code: 'missing_pmd_token', message: 'EIS_PMD_TOKEN is required.' };
    }
    if (!cfg.organizationInn?.trim()) {
      return {
        kind: 'config_error',
        outboundHttp: false,
        code: 'missing_organization_inn',
        message: 'EIS_ORGANIZATION_INN is required.',
      };
    }
    return {
      kind: 'config_error',
      outboundHttp: false,
      code: 'invalid_date_range',
      message: 'Unable to resolve outbound configuration.',
    };
  }

  private runOrgRegionEnvelope(
    operation: 'searchNoticesByRegion' | 'getNoticesByDateRange',
    regionCodeRaw: string,
    limit: number | undefined,
    dryRun: boolean,
    dateFrom?: Date,
    dateTo?: Date,
  ): EisOfficialConnectorCallResult {
    const cfg = resolveEisOfficialConnectorConfig(this.bag());
    if (!cfg.connectorEnabled) return { kind: 'disabled', outboundHttp: false, reason: 'env_flag_off' };

    const regionCode = regionCodeRaw?.trim() ?? '';
    if (!regionCode) {
      return {
        kind: 'config_error',
        outboundHttp: false,
        code: 'invalid_region_code',
        message: 'Region code is required.',
      };
    }

    if (dateFrom && dateTo && (Number.isNaN(dateFrom.getTime()) || Number.isNaN(dateTo.getTime()))) {
      return {
        kind: 'config_error',
        outboundHttp: false,
        code: 'invalid_date_range',
        message: 'Invalid date range.',
      };
    }

    const authToken = cfg.pmdToken ?? EIS_AUTH_TOKEN_REDACTION;
    const mode = cfg.pmdToken ? cfg.requestMode : parseEisRequestMode(readTrimmedEnv(this.bag(), EIS_REQUEST_MODE_ENV_KEY)) ?? 'TEST';
    const inn = cfg.organizationInn ?? '000000000000';

    if (dryRun) {
      const soap = buildGetDocsByOrgRegionRequest({
        authToken,
        requestMode: mode,
        organizationInn: inn,
        organizationKpp: cfg.organizationKpp,
        regionCode,
        limit,
      });
      if (!validateSoapEnvelopeStructure(soap)) {
        return {
          kind: 'config_error',
          outboundHttp: false,
          code: 'soap_envelope_invalid',
          message: 'SOAP envelope validation failed.',
        };
      }
      const redacted =
        cfg.pmdToken ? redactPmdTokenFromSoapEnvelope(soap, cfg.pmdToken) : redactPmdTokenFromSoapEnvelope(soap, authToken);
      return { kind: 'dry_run', outboundHttp: false, operation, soapEnvelopeRedacted: redacted };
    }

    if (cfg.outboundBlockedByCredentials) {
      return this.missingCredentialResult(cfg);
    }

    return { kind: 'live_http_not_wired', outboundHttp: false, operation };
  }

  /**
   * Maps a skeletal ЕИС XML/JSON payload into the shared procurement work-unit shape.
   * Intended for future official feeds; keeps ingestion rules centralized.
   */
  normalizeEisDocument(rawXmlOrJson: string | Record<string, unknown>): NormalizeEisDocumentResult {
    try {
      let row: Record<string, unknown>;
      let xmlSource: string | undefined;

      if (typeof rawXmlOrJson === 'string') {
        const t = rawXmlOrJson.trim();
        if (t.startsWith('{') || t.startsWith('[')) {
          row = JSON.parse(t) as Record<string, unknown>;
        } else {
          xmlSource = rawXmlOrJson;
          row = {};
        }
      } else {
        row = rawXmlOrJson;
      }

      const id =
        (typeof row.registryNumber === 'string' && row.registryNumber.trim())
        || (typeof row.id === 'string' && row.id.trim())
        || (xmlSource ? extractXmlText(xmlSource, 'registryNumber') || extractXmlText(xmlSource, 'RegistryNumber') : undefined);

      const title =
        (typeof row.docName === 'string' && row.docName.trim())
        || (typeof row.title === 'string' && row.title.trim())
        || (xmlSource ? extractXmlText(xmlSource, 'docName') || extractXmlText(xmlSource, 'DocName') : undefined);

      if (!id || !title) return { ok: false, message: 'Normalized document requires id/registryNumber and title/docName.' };

      const normalized = {
        id: id.trim(),
        title: title.trim(),
        customer: pickOptString(row, 'customer') ?? (xmlSource ? extractXmlText(xmlSource, 'customer') : undefined),
        regionHint: pickOptString(row, 'regionHint') ?? (xmlSource ? extractXmlText(xmlSource, 'regionHint') : undefined),
        subjectDetail: pickOptString(row, 'subjectDetail') ?? (xmlSource ? extractXmlText(xmlSource, 'subjectDetail') : undefined),
        procedureStage: pickOptString(row, 'procedureStage') ?? (xmlSource ? extractXmlText(xmlSource, 'procedureStage') : undefined),
        publishedAt: pickOptString(row, 'publishedAt') ?? (xmlSource ? extractXmlText(xmlSource, 'publishedAt') : undefined),
        updatedAt: pickOptString(row, 'updatedAt') ?? (xmlSource ? extractXmlText(xmlSource, 'updatedAt') : undefined),
        url: pickOptString(row, 'url') ?? (xmlSource ? extractXmlText(xmlSource, 'url') : undefined),
      };

      return { ok: true, workUnit: validatePublicProcurementRawNoticePayload(normalized) };
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Normalization failed.';
      return { ok: false, message: msg };
    }
  }
}

function pickOptString(row: Record<string, unknown>, key: string): string | undefined {
  const v = row[key];
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s || undefined;
}

function extractXmlText(raw: string | Record<string, unknown>, tag: string): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = raw.match(re);
  const inner = m?.[1]?.trim();
  return inner?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}
