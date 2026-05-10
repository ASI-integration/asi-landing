import type { EisOfficialConnectorEnv, EisOfficialConnectorResolvedConfig, EisRequestMode } from './eis-official-types';

export const EIS_OFFICIAL_CONNECTOR_ENABLED_ENV_KEY = 'EIS_OFFICIAL_CONNECTOR_ENABLED' as const;
export const EIS_PMD_TOKEN_ENV_KEY = 'EIS_PMD_TOKEN' as const;
export const EIS_SERVICE_BASE_URL_ENV_KEY = 'EIS_SERVICE_BASE_URL' as const;
export const EIS_REQUEST_MODE_ENV_KEY = 'EIS_REQUEST_MODE' as const;
export const EIS_ORGANIZATION_INN_ENV_KEY = 'EIS_ORGANIZATION_INN' as const;
export const EIS_ORGANIZATION_KPP_ENV_KEY = 'EIS_ORGANIZATION_KPP' as const;

/** Upper bound for inclusive notice queries (prevents runaway windows). */
export const EIS_OFFICIAL_MAX_DATE_RANGE_DAYS = 31;

/** Marker substituted into SOAP envelopes returned from dry-run paths (never a real secret). */
export const EIS_AUTH_TOKEN_REDACTION = '[EIS_PMD_TOKEN_REDACTED]' as const;

export function isEisOfficialConnectorEnabled(
  env: EisOfficialConnectorEnv | undefined = typeof process !== 'undefined' ? process.env : undefined,
): boolean {
  const raw = env?.[EIS_OFFICIAL_CONNECTOR_ENABLED_ENV_KEY];
  if (raw === undefined || raw === '') return false;
  const v = String(raw).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export function readTrimmedEnv(env: EisOfficialConnectorEnv | undefined, key: string): string | undefined {
  const v = env?.[key];
  if (v === undefined || v === null) return undefined;
  const t = String(v).trim();
  return t || undefined;
}

export function parseEisRequestMode(raw: string | undefined): EisRequestMode | undefined {
  if (!raw) return undefined;
  const u = String(raw).trim().toUpperCase();
  if (u === 'TEST' || u === 'PROD') return u;
  return undefined;
}

/**
 * Resolves ЕИС connector flags without performing network I/O.
 * Missing secrets do not throw; callers gate outbound/dry-run behaviour explicitly.
 */
export function resolveEisOfficialConnectorConfig(
  env: EisOfficialConnectorEnv | undefined = typeof process !== 'undefined' ? process.env : undefined,
): EisOfficialConnectorResolvedConfig {
  const connectorEnabled = isEisOfficialConnectorEnabled(env);
  const pmdToken = readTrimmedEnv(env, EIS_PMD_TOKEN_ENV_KEY);
  const serviceBaseUrl = readTrimmedEnv(env, EIS_SERVICE_BASE_URL_ENV_KEY);
  const organizationInn = readTrimmedEnv(env, EIS_ORGANIZATION_INN_ENV_KEY);
  const organizationKpp = readTrimmedEnv(env, EIS_ORGANIZATION_KPP_ENV_KEY);
  const modeParsed = parseEisRequestMode(readTrimmedEnv(env, EIS_REQUEST_MODE_ENV_KEY));

  const outboundBlockedByCredentials =
    !pmdToken ||
    !serviceBaseUrl ||
    !organizationInn ||
    modeParsed === undefined;

  return {
    connectorEnabled,
    outboundBlockedByCredentials,
    requestMode: modeParsed ?? 'TEST',
    serviceBaseUrl,
    pmdToken,
    organizationInn,
    organizationKpp,
  };
}
