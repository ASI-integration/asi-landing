/**
 * Non-executable wire contract. Parsing proves syntax only. No listener or transport.
 * Requests contain opaque digests/references, never approval data, clocks or transitions.
 */
import { check, exact, parseCanonical, HEX, UUID } from '../protocol';
const COMMON = ['schemaVersion','requestId','op','leaseDigest','nonce','scopeDigest','journalIdentity',
  'ownerRootRef','custodianRootRef'];
const OPS = ['CLAIM','STATUS','STOP','REQUEST_FAULT'] as const;
const FAULTS = ['commit-ack-loss','restart-replay','utc-boundary','crm-receipt-atomicity'] as const;
const EXTRA = ['fault','runId','fixtureNamespace','ownedPid','startDigest','bootDigest','executableSha256','backendPid'];
export function validateRequestSyntax(text: unknown) {
  try {
    const r = parseCanonical(text, 4096);
    check(r.schemaVersion === 'asi.lab.native-request.v1' && typeof r.op === 'string' &&
      (OPS as readonly string[]).includes(r.op));
    exact(r, r.op === 'REQUEST_FAULT' ? [...COMMON,...EXTRA] : COMMON);
    check(typeof r.requestId === 'string' && UUID.test(r.requestId));
    for (const k of ['leaseDigest','nonce','scopeDigest','journalIdentity','ownerRootRef','custodianRootRef'])
      check(typeof r[k] === 'string' && HEX.test(r[k] as string));
    check(r.ownerRootRef !== r.custodianRootRef, 'INDEPENDENT_ROOTS_REQUIRED');
    if (r.op === 'REQUEST_FAULT') {
      check(typeof r.fault === 'string' && (FAULTS as readonly string[]).includes(r.fault));
      for (const k of ['runId','fixtureNamespace']) check(typeof r[k] === 'string' && UUID.test(r[k] as string));
      for (const k of ['startDigest','bootDigest','executableSha256']) check(typeof r[k] === 'string' && HEX.test(r[k] as string));
      for (const k of ['ownedPid','backendPid']) check(typeof r[k] === 'number' &&
        Number.isSafeInteger(r[k]) && Number(r[k]) > 0 && Number(r[k]) <= 2147483647);
    }
    return Object.freeze({ state: 'UNIT_ONLY', syntaxValid: true, executionAuthorized: false });
  } catch { return Object.freeze({ state: 'BLOCKED', syntaxValid: false, executionAuthorized: false }); }
}
/** Shape intentionally cannot represent an accepted/claimed/executed service response. */
export function validateDeniedResponse(text: unknown) {
  try {
    const r = parseCanonical(text, 1024);
    exact(r, ['schemaVersion','state','reason','executionAuthorized','databaseCalls','sqlCalls','realMessageCalls','ipcCalls','storeWrites']);
    check(r.schemaVersion === 'asi.lab.native-response.v1' && r.state === 'BLOCKED' &&
      r.reason === 'PROTECTED_SERVICE_NOT_INSTALLED' && r.executionAuthorized === false);
    for (const k of ['databaseCalls','sqlCalls','realMessageCalls','ipcCalls','storeWrites']) check(r[k] === 0);
    return true;
  } catch { return false; }
}
/**
 * Future native endpoint must derive peer context from connected pipe handles:
 * GetNamedPipe{Client,Server}ProcessId + held process handles/start time;
 * ImpersonateNamedPipeClient -> OpenThreadToken -> verified token/security level;
 * RevertToSelf in finally; verify server token, pipe owner/DACL and service identity.
 * PID is correlation only. No JSON peer context, exported factory, callback or key registry.
 */
export function handleNativeRequest(_body?: unknown, _allegedPeer?: unknown) {
  return Object.freeze({ schemaVersion: 'asi.lab.native-response.v1', state: 'BLOCKED',
    reason: 'PROTECTED_SERVICE_NOT_INSTALLED', executionAuthorized: false,
    databaseCalls: 0, sqlCalls: 0, realMessageCalls: 0, ipcCalls: 0, storeWrites: 0 });
}
if (typeof require !== 'undefined' && require.main === module) {
  console.log(JSON.stringify(handleNativeRequest())); process.exitCode = 2;
}
