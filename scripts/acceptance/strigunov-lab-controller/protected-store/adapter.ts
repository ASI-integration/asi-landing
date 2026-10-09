/**
 * Production-intended service boundary. There is NO installed protected storage.
 * No import of unit-file-store, no Map, file I/O, driver, pipe, roots or credential reads.
 */
export interface ProtectedLeaseScope {
  envelopeDigest: string; ownerArtifactDigest: string; custodianArtifactDigest: string;
  ownerRootVersion: string; custodianRootVersion: string; revocationEpoch: number;
  nonce: string; runId: string; fixtureNamespace: string; hostIdentityDigest: string;
  nativeSourceSha: string; nativeBinarySha256: string; clusterIdentityDigest: string;
  appSha: string; migrationSha256: string; scenarioSetDigest: string; roleSetDigest: string;
  expiresAtMs: number; maxDurationMs: number; maxQueries: number; maxWrites: number; maxRows: number;
}
/** Specification, NOT caller-supplied runtime context. Never exported as a factory input. */
export interface ProtectedCommitRequirements {
  scope: Readonly<ProtectedLeaseScope>;
  expectedGeneration: number; expectedHead: string; nextRecordDigest: string;
  protectedRootIdentity: string; externalMonotonicAnchorIdentity: string;
  authenticatedPeerAndServiceDigest: string;
  // Atomically consume nonce / advance head / persist revocation under one protected transaction.
  durableNonceAndHeadCas: true;
  directoryDurabilityProven: true;
  anchorOutsideMutableJournal: true;
  acknowledgeBeforeDispatch: true;
}
const deny = () => Object.freeze({ state: 'BLOCKED', reason: 'PROTECTED_STORE_NOT_INSTALLED',
  executionAuthorized: false, leaseClaimed: false, durableAck: false, storeWrites: 0,
  databaseCalls: 0, sqlCalls: 0, realMessageCalls: 0 });
export function claimLease(_wire?: unknown) { return deny(); }
export function commitIntent(_wire?: unknown) { return deny(); }
export function requestCleanup(_wire?: unknown) { return deny(); }
export function requestStop(_wire?: unknown) { return deny(); }
export function recoverLease(_wire?: unknown) {
  // Timeout/restart never means an ambiguous nonce is available. No automatic wipe/reset.
  return Object.freeze({ ...deny(), state: 'RECOVERY_REQUIRED', reason: 'PROTECTED_RECOVERY_NOT_INSTALLED' });
}
