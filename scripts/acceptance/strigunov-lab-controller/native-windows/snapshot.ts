/** Detached content checker. No process launch, probe, IPC or authority is exported here. */
import { check, exact, object, parseCanonical, HEX } from '../protocol';
const SID = /^S-1-[0-9-]{3,100}$/;
const integer = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const decimal = (v: unknown) => typeof v === 'string' && /^[0-9]{1,20}$/.test(v);
const hash = (v: unknown) => typeof v === 'string' && HEX.test(v);
/** Canonical snapshot fixtures only, NOT a way to import a native capability. */
export function compareSnapshotModel(expectedText: unknown, observedText: unknown) {
  try {
    const e = parseCanonical(expectedText, 4096), s = parseCanonical(observedText, 8192);
    const identity = ['pid','parentPid','sessionId','userSid','integritySid','authenticationId','startFileTime'];
    exact(e, [...identity, 'executableSha256','fileId','pathDigest','aclDigest']);
    exact(s, ['schemaVersion','state','reason','executionAuthorized','tokenObserved','identityStable',
      ...identity,'elevated','uptimeMilliseconds','bootIdentityStatus','bootTimeFileTime','bootTimeStable','matchingServiceCount','serviceStatus','pipeStatus','executable']);
    check(s.schemaVersion === 'asi.windows.diagnostic.v1' && s.state === 'DIAGNOSTIC_ONLY' &&
      s.reason === 'HOST_NOT_PROVISIONED' && s.executionAuthorized === false);
    for (const key of identity) check(s[key] === e[key], 'IDENTITY_MISMATCH');
    check(integer(s.pid) && Number(s.pid) > 0 && integer(s.parentPid) && Number(s.parentPid) > 0 &&
      integer(s.sessionId) && typeof s.userSid === 'string' && SID.test(s.userSid) &&
      typeof s.integritySid === 'string' && SID.test(s.integritySid) &&
      decimal(s.startFileTime) && decimal(s.authenticationId) && decimal(s.uptimeMilliseconds) &&
      decimal(s.bootTimeFileTime) && s.bootTimeStable === true && integer(s.matchingServiceCount));
    check(s.tokenObserved === true && s.identityStable === true && s.elevated === true, 'TOKEN_UNAVAILABLE');
    // No timestamp approximation is accepted as a boot identity.
    check(s.bootIdentityStatus === 'UNAVAILABLE' && s.serviceStatus === 'NOT_INSTALLED' && s.pipeStatus === 'NOT_INSTALLED');
    const p = object(s.executable);
    exact(p, ['status','reason','handlesObserved','fileId','pathDigest','executableSha256','aclDigest',
      'identitiesStable','conservativeAclSafe','effectiveAccessProven','executionAuthorized']);
    check(p.status === 'DIAGNOSTIC_ONLY' && p.reason === 'EFFECTIVE_ACCESS_UNPROVEN' &&
      p.identitiesStable === true && p.conservativeAclSafe === true &&
      p.effectiveAccessProven === false && p.executionAuthorized === false &&
      integer(p.handlesObserved) && Number(p.handlesObserved) >= 2 && Number(p.handlesObserved) <= 32);
    for (const k of ['pathDigest','executableSha256','aclDigest']) check(hash(p[k]) && p[k] === e[k]);
    check(typeof p.fileId === 'string' && /^[0-9a-f]{24}$/.test(p.fileId) && p.fileId === e.fileId);
    return Object.freeze({ state: 'UNIT_ONLY', contentConsistent: true, hostAuthenticated: false,
      executionAuthorized: false, reason: 'HOST_NOT_PROVISIONED' });
  } catch {
    return Object.freeze({ state: 'BLOCKED', contentConsistent: false, hostAuthenticated: false,
      executionAuthorized: false, reason: 'HOST_AUTHN_UNAVAILABLE' });
  }
}
export function authenticateNativeHost(_input?: unknown) {
  return Object.freeze({ state: 'BLOCKED', reason: 'HOST_NOT_PROVISIONED', executionAuthorized: false });
}
export function authenticatePipePeer(_input?: unknown) {
  return Object.freeze({ state: 'BLOCKED', reason: 'PIPE_AUTHENTICATOR_NOT_INSTALLED', executionAuthorized: false });
}
