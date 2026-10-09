/**
 * Native/protected adapters are deliberately NOT INSTALLED. No OS query, roots read,
 * credential read, IPC listener, database driver, networking or process action occurs.
 * Caller-supplied evidence is never an OS observation or an authorization source.
 */
import { canonical, check, claimsFromText, exact, parseCanonical } from './protocol';
export type EvidenceState = 'PLAN_ONLY' | 'UNIT_ONLY' | 'POSTGRES_STATIC_ONLY' | 'ISOLATED_ACCEPTED' |
  'BLOCKED' | 'RECOVERY_REQUIRED' | 'PRODUCTION_RECEIPT';
export type FaultKind = 'commit-ack-loss' | 'restart-replay' | 'utc-boundary' | 'crm-receipt-atomicity';
export interface FutureOwnedFaultRequest {
  kind: FaultKind;
  signedLeaseDigest: string;
  nonce: string;
  runId: string;
  fixtureNamespace: string;
  ownedProcess: { pid: number; startDigest: string; bootDigest: string; executableSha256: string };
  ownedBackendPid: number;
  scenarioId: string;
  deadlineUtcMs: number;
}
/** Requirements for an authenticated native probe, not a JSON shape that grants trust. */
export interface FutureNativeAuthority {
  tokenSid: string; tokenAuthenticationId: string; serviceSid: string; serviceAccountSid: string;
  processStartDigest: string; bootDigest: string; executableFileId: string; executableSha256: string;
  openedAncestorHandleIds: readonly string[]; ancestorOwnersAndDaclDigest: string;
  dangerousReplaceRightsDenied: true; allReparseKindsDenied: true; serviceConfigProtected: true;
  pipeServerAndClientTokenDigest: string; impersonationChecked: true;
}
/** Future observation must be produced by the custodian service, never a GET/CLI payload. */
export interface FutureTargetObservation {
  clusterSystemId: string; serverVersion: string; databaseOid: number; databaseNameDigest: string;
  serverBootDigest: string; namespaceOwnerDigest: string; actualEndpointDigest: string;
  pinnedAllowlistDigest: string; allResolvedAddressesDigest: string;
  productionAndStagingDenied: true; publicAndAmbiguousAddressesDenied: true;
  proxyAndTunnelDenied: true; dnsRebindingPrevented: true; exclusivePristine: true;
  appliedSchemaVersion: string; appliedSchemaSha256: string; migrationSha256: string;
  actualRolePrivilegesDigest: string; actualForcedRlsDigest: string;
  physicalEgressDenialDigest: string; providerPathsDenied: true;
}
function denied(reason: string) {
  return Object.freeze({ state: 'BLOCKED' as const, reason, executionAuthorized: false as const,
    sqlCalls: 0, databaseCalls: 0, realMessageCalls: 0 });
}
export function verifyOwnerAuthorization(_input?: unknown) { return denied('ISSUER_NOT_PROVISIONED'); }
export function attestNativeHost(_input?: unknown) { return denied('HOST_AUTHENTICATOR_NOT_INSTALLED'); }
export function attestLabTarget(_input?: unknown) { return denied('TARGET_NOT_VERIFIED'); }
export function claimProtectedLease(_input?: unknown) { return denied('PROTECTED_STORE_NOT_INSTALLED'); }
export function controlOwnedFault(_input?: unknown) { return denied('FAULT_CONTROLLER_NOT_INSTALLED'); }
export function issueAuthenticatedReceipt(_input?: unknown) { return denied('RECEIPT_SIGNER_NOT_PROVISIONED'); }

/** Tests of required observation content only; even a match is explicitly NOT OS authentication. */
export function compareHostObservationModel(claimsText: unknown, observationText: unknown) {
  try {
    const c = claimsFromText(claimsText), p = parseCanonical(observationText);
    const fields = ['serviceSid','serviceAccountSid','hostBootDigest','processStartDigest',
      'executablePathDigest','executableSha256','ancestorAclDigest','pipePeerDigest'];
    const checks = ['tokenVerified','immutableBinary','ancestorsProtected','replaceRightsDenied',
      'reparseDenied','pipePeerTokenVerified','serviceConfigProtected'];
    exact(p, ['authorityClass', ...fields, ...checks]); check(p.authorityClass === 'UNIT_ONLY');
    for (const field of fields) check(p[field] === c[field], 'HOST_IDENTITY_MISMATCH');
    for (const field of checks) check(p[field] === true, 'HOST_POLICY_MISSING');
    return { state: 'UNIT_ONLY', modelValid: true, hostAuthenticated: false, executionAuthorized: false };
  } catch { return { state: 'BLOCKED', modelValid: false, hostAuthenticated: false, executionAuthorized: false }; }
}
export function compareTargetObservationModel(claimsText: unknown, observationText: unknown) {
  try {
    const c = claimsFromText(claimsText), p = parseCanonical(observationText);
    const fields = ['targetAlias','machineDigest','clusterSystemId','databaseOid','databaseNameDigest',
      'serverBootDigest','containerDigest','networkNamespaceDigest','endpointDigest','schemaSha256',
      'schemaVersionId','migrationSha256','egressPolicyDigest'];
    const checks = ['exclusive','pristine','actualPrivilegesVerified','forcedRlsVerified','physicalEgressDenied',
      'providerPathsDenied','productionDenied','stagingDenied','allAddressesNonPublic',
      'dnsRebindDenied','proxyDenied','tunnelDenied','protectedAllowlistMatched'];
    exact(p, ['authorityClass', ...fields, ...checks]); check(p.authorityClass === 'UNIT_ONLY');
    for (const field of fields) check(canonical(p[field]) === canonical(c[field]), 'TARGET_MISMATCH');
    for (const field of checks) check(p[field] === true, 'TARGET_POLICY_MISSING');
    return { state: 'UNIT_ONLY', modelValid: true, targetAuthenticated: false, executionAuthorized: false };
  } catch { return { state: 'BLOCKED', modelValid: false, targetAuthenticated: false, executionAuthorized: false }; }
}
