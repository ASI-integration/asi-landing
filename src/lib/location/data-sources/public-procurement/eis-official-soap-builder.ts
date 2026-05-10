import { EIS_AUTH_TOKEN_REDACTION } from './eis-official-config';
import type { EisRequestMode } from './eis-official-types';

/** Placeholder XML namespace for skeleton envelopes — not a live zakupki.gov.ru endpoint. */
export const EIS_SOAP_PLACEHOLDER_NS = 'urn:asi:eis-official-connector:skeleton:v1';

export interface BuildGetDocsByOrgRegionSoapParams {
  readonly authToken: string;
  readonly requestMode: EisRequestMode;
  readonly organizationInn: string;
  readonly organizationKpp?: string;
  readonly regionCode: string;
  readonly limit?: number;
}

export interface BuildGetDocsByReestrNumberSoapParams {
  readonly authToken: string;
  readonly requestMode: EisRequestMode;
  readonly registryNumber: string;
}

function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function assertNonEmpty(field: string, label: string): void {
  if (!field.trim()) throw new Error(`eis soap builder: missing ${label}`);
}

/**
 * Builds a SOAP 1.1 envelope for org/region document discovery (skeleton operation names).
 * Caller must never log raw {@link BuildGetDocsByOrgRegionSoapParams.authToken}.
 */
export function buildGetDocsByOrgRegionRequest(params: BuildGetDocsByOrgRegionSoapParams): string {
  assertNonEmpty(params.authToken, 'auth token');
  assertNonEmpty(params.organizationInn, 'organization inn');
  assertNonEmpty(params.regionCode, 'region code');
  const limit = params.limit !== undefined ? Math.min(Math.max(0, Math.floor(params.limit)), 500) : 50;
  const kppXml = params.organizationKpp?.trim()
    ? `<OrganizationKPP>${escapeXmlText(params.organizationKpp.trim())}</OrganizationKPP>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:eis="${EIS_SOAP_PLACEHOLDER_NS}">
  <soapenv:Header>
    <eis:PmdAuthToken>${escapeXmlText(params.authToken)}</eis:PmdAuthToken>
    <eis:RequestMode>${escapeXmlText(params.requestMode)}</eis:RequestMode>
  </soapenv:Header>
  <soapenv:Body>
    <eis:GetDocsByOrgRegion>
      <OrganizationINN>${escapeXmlText(params.organizationInn.trim())}</OrganizationINN>
      ${kppXml}
      <RegionCode>${escapeXmlText(params.regionCode.trim())}</RegionCode>
      <Limit>${limit}</Limit>
    </eis:GetDocsByOrgRegion>
  </soapenv:Body>
</soapenv:Envelope>`;
}

export function buildGetDocsByReestrNumberRequest(params: BuildGetDocsByReestrNumberSoapParams): string {
  assertNonEmpty(params.authToken, 'auth token');
  assertNonEmpty(params.registryNumber, 'registry number');

  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:eis="${EIS_SOAP_PLACEHOLDER_NS}">
  <soapenv:Header>
    <eis:PmdAuthToken>${escapeXmlText(params.authToken)}</eis:PmdAuthToken>
    <eis:RequestMode>${escapeXmlText(params.requestMode)}</eis:RequestMode>
  </soapenv:Header>
  <soapenv:Body>
    <eis:GetDocsByReestrNumber>
      <RegistryNumber>${escapeXmlText(params.registryNumber.trim())}</RegistryNumber>
    </eis:GetDocsByReestrNumber>
  </soapenv:Body>
</soapenv:Envelope>`;
}

export function redactPmdTokenFromSoapEnvelope(soapXml: string, pmdToken: string): string {
  if (!pmdToken) return soapXml.replace(/<eis:PmdAuthToken>[\s\S]*?<\/eis:PmdAuthToken>/, `<eis:PmdAuthToken>${EIS_AUTH_TOKEN_REDACTION}</eis:PmdAuthToken>`);
  const escaped = pmdToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return soapXml.replace(new RegExp(`<eis:PmdAuthToken>\\s*${escaped}\\s*</eis:PmdAuthToken>`), `<eis:PmdAuthToken>${EIS_AUTH_TOKEN_REDACTION}</eis:PmdAuthToken>`);
}

export function validateSoapEnvelopeStructure(soapXml: string): boolean {
  const s = soapXml.trim();
  return (
    s.includes('<soapenv:Envelope') &&
    s.includes('<soapenv:Header') &&
    s.includes('<soapenv:Body') &&
    s.includes('<eis:PmdAuthToken>') &&
    s.includes(EIS_SOAP_PLACEHOLDER_NS)
  );
}
