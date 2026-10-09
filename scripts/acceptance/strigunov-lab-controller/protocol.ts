/**
 * Bounded cryptographic verification MODEL. No keys, provisioning, signing or authority
 * factory lives here. A valid model envelope is never a capability for the real harness.
 */
import { createHash, createPublicKey, verify } from 'node:crypto';
import { PINS, SCENARIOS } from '../strigunov-public-lead-postgres-contract';

export const PARENT_SHA = '6331de62d92e070a932670ce3aa8c31ad39872c8';
export const MODEL_DOMAIN = 'ASI-STRIGUNOV-LAB-UNIT-ONLY/v1\n';
export const HEX = /^[0-9a-f]{64}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type ObjectJson = { [key: string]: Json };
export function check(condition: unknown, code = 'INVALID_CONTRACT'): asserts condition {
  if (!condition) throw new Error(code);
}
export function object(value: Json): ObjectJson {
  check(value !== null && typeof value === 'object' && !Array.isArray(value)); return value as ObjectJson;
}
export function exact(value: ObjectJson, names: readonly string[]) {
  check(Object.keys(value).sort().join('|') === [...names].sort().join('|'));
}
export function canonical(value: Json, depth = 0): string {
  // Internal parsed JSON only; public entry points reject objects before any property access.
  check(depth <= 8);
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { check(Number.isSafeInteger(value) && !Object.is(value, -0)); return String(value); }
  if (typeof value === 'string') { check(value.length <= 2048 && /^[\x20-\x7e]*$/.test(value)); return JSON.stringify(value); }
  if (Array.isArray(value)) { check(value.length <= 1000); return '[' + value.map(v => canonical(v, depth + 1)).join(',') + ']'; }
  const keys = Object.keys(value).sort(); check(keys.length <= 80);
  check(keys.every(k => /^[a-zA-Z][a-zA-Z0-9]*$/.test(k) && k !== 'constructor' && k !== 'prototype'));
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonical(value[k], depth + 1)).join(',') + '}';
}
export function parseCanonical(text: unknown, maxBytes = 32768): ObjectJson {
  check(typeof text === 'string' && Buffer.byteLength(text, 'utf8') <= maxBytes);
  const value = object(JSON.parse(text) as Json);
  check(canonical(value) === text, 'NON_CANONICAL'); // rejects duplicate keys, whitespace, escapes, alternate numbers
  return value;
}
/** Formatting helper only; input is text, never a callback-bearing caller object. */
export function canonicalizeModelJson(text: unknown): string {
  check(typeof text === 'string' && Buffer.byteLength(text, 'utf8') <= 32768);
  return canonical(JSON.parse(text) as Json);
}
export function digest(text: string) { return createHash('sha256').update(text).digest('hex'); }
function integer(value: Json, low: number, high: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= low && value <= high;
}
function token(value: Json): value is string { return typeof value === 'string' && /^[a-z][a-z0-9-]{2,63}$/.test(value); }
export interface Claims extends ObjectJson {
  schemaVersion: string; authorityClass: 'UNIT_ONLY'; repo: string; harnessSha: string; appSha: string;
  migrationSha256: string; policySourceSha256: string; policyContentSha256: string; policyVersion: string;
  ownerPrincipal: string; custodianPrincipal: string; ownerArtifactDigest: string; custodianArtifactDigest: string;
  nonce: string; runId: string; fixtureNamespace: string; scenarios: string[]; roles: string[];
  issuedAtMs: number; notBeforeMs: number; expiresAtMs: number; maxDurationMs: number;
  maxQueries: number; maxWrites: number; maxRows: number; cleanupMaxRows: number; cleanupMode: string;
  targetAlias: string; targetClass: string; machineDigest: string; clusterSystemId: string;
  databaseOid: number; databaseNameDigest: string; serverBootDigest: string; containerDigest: string;
  networkNamespaceDigest: string; endpointDigest: string; schemaSha256: string; schemaVersionId: string;
  serviceSid: string; serviceAccountSid: string; hostBootDigest: string; processStartDigest: string;
  executablePathDigest: string; executableSha256: string; ancestorAclDigest: string; pipePeerDigest: string;
  egressPolicyDigest: string; pristine: true; exclusive: true; noSend: true; noEgress: true;
  noProduction: true; noStaging: true; noMigrations: true;
}
const CLAIM_FIELDS = [
  'schemaVersion','authorityClass','repo','harnessSha','appSha','migrationSha256','policySourceSha256',
  'policyContentSha256','policyVersion','ownerPrincipal','custodianPrincipal','ownerArtifactDigest',
  'custodianArtifactDigest','nonce','runId','fixtureNamespace','scenarios','roles','issuedAtMs','notBeforeMs',
  'expiresAtMs','maxDurationMs','maxQueries','maxWrites','maxRows','cleanupMaxRows','cleanupMode',
  'targetAlias','targetClass','machineDigest','clusterSystemId','databaseOid','databaseNameDigest',
  'serverBootDigest','containerDigest','networkNamespaceDigest','endpointDigest','schemaSha256','schemaVersionId',
  'serviceSid','serviceAccountSid','hostBootDigest','processStartDigest','executablePathDigest',
  'executableSha256','ancestorAclDigest','pipePeerDigest','egressPolicyDigest','pristine','exclusive',
  'noSend','noEgress','noProduction','noStaging','noMigrations',
] as const;
export function validateClaims(value: ObjectJson): Claims {
  exact(value, CLAIM_FIELDS);
  check(value.schemaVersion === 'asi.lab.capability.v1' && value.authorityClass === 'UNIT_ONLY');
  check(value.repo === 'ASI-integration/asi-landing' && value.harnessSha === PARENT_SHA &&
    value.appSha === PINS.parentSha && value.migrationSha256 === PINS.migrationSha256 &&
    value.policySourceSha256 === PINS.policySourceSha256 && value.policyVersion === PINS.policyVersion, 'PIN_MISMATCH');
  for (const [name, v] of Object.entries(value)) {
    if (name.endsWith('Digest') || name.endsWith('Sha256') || name === 'nonce') check(typeof v === 'string' && HEX.test(v));
  }
  check(token(value.ownerPrincipal) && token(value.custodianPrincipal) && value.ownerPrincipal !== value.custodianPrincipal, 'PRINCIPALS_NOT_DISTINCT');
  check(typeof value.runId === 'string' && UUID.test(value.runId) &&
    typeof value.fixtureNamespace === 'string' && UUID.test(value.fixtureNamespace));
  check(token(value.targetAlias) && value.targetClass === 'DISPOSABLE_ISOLATED' &&
    typeof value.clusterSystemId === 'string' && /^[1-9][0-9]{10,19}$/.test(value.clusterSystemId) &&
    integer(value.databaseOid, 1, 4294967295) && token(value.schemaVersionId));
  for (const name of ['serviceSid','serviceAccountSid']) check(typeof value[name] === 'string' && /^S-1-[0-9-]{3,100}$/.test(value[name] as string));
  for (const name of ['pristine','exclusive','noSend','noEgress','noProduction','noStaging','noMigrations']) check(value[name] === true, 'POLICY_NOT_DENY');
  for (const name of ['issuedAtMs','notBeforeMs','expiresAtMs']) check(integer(value[name], 1, Number.MAX_SAFE_INTEGER));
  check(integer(value.maxDurationMs, 1, 600000) && integer(value.maxQueries, 1, 20000) &&
    integer(value.maxWrites, 1, 2000) && integer(value.maxRows, 1, 1000) &&
    integer(value.cleanupMaxRows, 1, 1000) && value.cleanupMaxRows <= value.maxRows &&
    value.cleanupMode === 'EXACT_JOURNALED_UUIDS');
  const c = value as Claims;
  check(c.issuedAtMs <= c.notBeforeMs && c.notBeforeMs < c.expiresAtMs &&
    c.expiresAtMs - c.issuedAtMs <= 600000 && c.maxDurationMs <= c.expiresAtMs - c.notBeforeMs);
  for (const [name, allowed] of [
    ['scenarios', SCENARIOS.map(s => s.id)],
    ['roles', ['anon','authenticated','observer','service-a','service-b']],
  ] as const) {
    const items = value[name]; check(Array.isArray(items) && items.length > 0);
    check(items.every(x => typeof x === 'string' && (allowed as readonly string[]).includes(x)) &&
      canonical(items) === canonical([...new Set(items)].sort()), 'SCOPE_INVALID');
  }
  return c;
}
export function claimsFromText(text: unknown) { return validateClaims(parseCanonical(text)); }
export function clockValid(c: Claims, now: number) {
  return Number.isSafeInteger(now) && c.issuedAtMs <= now && c.notBeforeMs <= now && now < c.expiresAtMs;
}
function b64(value: Json, size: number) {
  check(typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value));
  const bytes = Buffer.from(value, 'base64url');
  check(bytes.length === size && bytes.toString('base64url') === value); return bytes;
}
/** Called only after strict JSON parsing; roots are test fixtures, not protected trust roots. */
function signaturesModel(payload: ObjectJson, sigs: Json, roots: ObjectJson, domain: string) {
  exact(roots, ['authorityClass','keys']); check(roots.authorityClass === 'UNIT_ONLY');
  check(Array.isArray(roots.keys) && roots.keys.length === 2 && Array.isArray(sigs) && sigs.length === 2, 'TWO_SIGNATURES_REQUIRED');
  const principals = new Set<string>(), fingerprints = new Set<string>();
  for (const role of ['owner','custodian']) {
    const matches = roots.keys.map(object).filter(r => r.role === role);
    const signed = sigs.map(object).filter(s => s.role === role);
    check(matches.length === 1 && signed.length === 1, 'TWO_SIGNATURES_REQUIRED');
    const root = matches[0], sig = signed[0];
    exact(root, ['role','principalId','keyId','publicKeyDer']);
    exact(sig, ['role','principalId','keyId','algorithm','signature']);
    check(token(root.principalId) && root.principalId === payload[role + 'Principal'] &&
      sig.principalId === root.principalId && sig.keyId === root.keyId && sig.algorithm === 'Ed25519', 'SIGNER_MISMATCH');
    const der = b64(root.publicKeyDer, 44);
    check(root.keyId === createHash('sha256').update(der).digest('hex'), 'KEY_PIN_MISMATCH');
    const key = createPublicKey({ key: der, type: 'spki', format: 'der' });
    check(key.asymmetricKeyType === 'ed25519' && key.export({ type: 'spki', format: 'der' }).equals(der), 'KEY_TYPE_REJECTED');
    principals.add(root.principalId as string); fingerprints.add(root.keyId as string);
    check(verify(null, Buffer.from(domain + canonical(payload)), key, b64(sig.signature, 64)), 'SIGNATURE_INVALID');
  }
  check(principals.size === 2 && fingerprints.size === 2, 'PRINCIPALS_NOT_DISTINCT');
}
export function verifyEnvelopeModel(envelopeText: unknown, rootsText: unknown, now: number) {
  try {
    const e = parseCanonical(envelopeText), roots = parseCanonical(rootsText, 4096);
    exact(e, ['claims','signatures']);
    const c = validateClaims(object(e.claims)); check(clockValid(c, now), 'AUTHORIZATION_TIME');
    signaturesModel(c, e.signatures, roots, MODEL_DOMAIN);
    return { state: 'UNIT_ONLY' as const, modelValid: true, executionAuthorized: false as const,
      claimsDigest: digest(canonical(c)), claims: c };
  } catch {
    return { state: 'BLOCKED' as const, modelValid: false, executionAuthorized: false as const };
  }
}

/** Bounded authenticated receipt model; real evidence requires the uninstalled service. */
export function verifyReceiptModel(receiptText: unknown, rootsText: unknown, envelopeText: unknown, now: number) {
  try {
    const envelope = verifyEnvelopeModel(envelopeText, rootsText, now); check(envelope.modelValid && envelope.claims);
    const c = envelope.claims, r = parseCanonical(receiptText, 65536);
    exact(r, ['receipt','signatures']); const p = object(r.receipt);
    exact(p, ['schemaVersion','authorityClass','state','ownerPrincipal','custodianPrincipal','claimsDigest',
      'nonce','runId','appSha','migrationSha256','targetDigest','policySourceSha256','policyContentSha256',
      'policyVersion','noSendDigest','journalHead','startedAtMs','finishedAtMs','queryCount','writeCount','scenarios','workers','backendPids','fixtures','created','deleted','remaining','errorCategories']);
    check(p.schemaVersion === 'asi.lab.receipt.v1' && p.authorityClass === 'UNIT_ONLY' && p.state === 'UNIT_ONLY');
    for (const field of ['ownerPrincipal','custodianPrincipal','nonce','runId','appSha','migrationSha256','policySourceSha256','policyContentSha256','policyVersion'])
      check(p[field] === c[field]);
    check(p.claimsDigest === envelope.claimsDigest && p.targetDigest === digest(canonical(c)) &&
      p.noSendDigest === c.egressPolicyDigest && typeof p.journalHead === 'string' && HEX.test(p.journalHead));
    check(integer(p.startedAtMs, c.notBeforeMs, c.expiresAtMs - 1) &&
      integer(p.finishedAtMs, p.startedAtMs, c.expiresAtMs - 1) &&
      p.finishedAtMs <= now && p.finishedAtMs - p.startedAtMs <= c.maxDurationMs &&
      integer(p.queryCount, 0, c.maxQueries) && integer(p.writeCount, 0, c.maxWrites), 'RECEIPT_BUDGET');
    check(canonical(p.scenarios) === canonical(c.scenarios));
    check(Array.isArray(p.workers) && p.workers.length === 2 && Array.isArray(p.backendPids) &&
      p.backendPids.length === 2 && p.backendPids.every(v => integer(v, 1, 2147483647)) && new Set(p.backendPids).size === 2);
    const workers = p.workers.map(object);
    for (const worker of workers) {
      exact(worker, ['pid','startDigest','bootDigest']);
      check(integer(worker.pid, 1, 2147483647) && typeof worker.startDigest === 'string' &&
        HEX.test(worker.startDigest) && worker.bootDigest === c.hostBootDigest);
    }
    check(new Set(workers.map(w => w.pid)).size === 2 && new Set(workers.map(w => w.startDigest)).size === 2);
    check(Array.isArray(p.fixtures) && p.fixtures.length <= c.maxRows &&
      p.created === p.fixtures.length && p.deleted === p.created && p.remaining === 0);
    const ids = new Set();
    for (const item of p.fixtures) {
      const f = object(item); exact(f, ['crmId','submissionDigest','consentDigest','cleanup']);
      check(typeof f.crmId === 'string' && UUID.test(f.crmId) && !ids.has(f.crmId));
      ids.add(f.crmId);
      check(typeof f.submissionDigest === 'string' && HEX.test(f.submissionDigest) &&
        typeof f.consentDigest === 'string' && HEX.test(f.consentDigest) && f.cleanup === 'VERIFIED');
    }
    check(Array.isArray(p.errorCategories) && p.errorCategories.every(e =>
      ['SERIALIZATION','DEADLOCK','LOCK_TIMEOUT','PRIVILEGE_DENIED','MISSING_RPC','ADMISSION_REJECTED'].includes(String(e))));
    signaturesModel(p, r.signatures, parseCanonical(rootsText, 4096), MODEL_DOMAIN + 'RECEIPT\n');
    return { state: 'UNIT_ONLY' as const, modelValid: true, executionAuthorized: false as const };
  } catch { return { state: 'BLOCKED' as const, modelValid: false, executionAuthorized: false as const }; }
}
