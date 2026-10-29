/**
 * P0 #551 — PROPOSAL ONLY: protected read-only trust roots and revocations.
 *
 * This does not grant permission to merge, deploy, publish, or perform effects.
 * The future protected-base verifier must provide a PINNED expected context;
 * the executing PR and agent must not select trusted fingerprints or revision.
 * Load this only from trusted installed code, not pull-request source.
 *
 * Existing host-authority.rootOwned enforces root ownership, no symlink,
 * single hard link and non-world/group-writable protected files/directories.
 * No signing key or secret is created, requested, loaded or returned here.
 */
import path from 'node:path';
import {createHash, createPublicKey, verify} from 'node:crypto';
import {AUTHORITY_DIR, rootOwned} from '../strigunov4/execution-adapters/host-authority.mjs';

const REPO = 'ASI-integration/asi-landing';
const ENVIRONMENT = 'beget-staging';
const TARGET = 'pqukibofpo';
const DAY = 86400000;
const DIGEST = /^[a-f0-9]{64}$/;
const SIGNATURE = /^[A-Za-z0-9+/]{86}==$/;
const FILES = Object.freeze({
  issuer: path.join(AUTHORITY_DIR, 'owner-public.pem'),
  verifier: path.join(AUTHORITY_DIR, 'standing-verifier-public.pem'),
  revocations: path.join(AUTHORITY_DIR, 'standing-revocations.json'),
});
const deny = reason => Object.freeze({status:'BLOCKED', reason, authorized:false});
const sha256 = buf => createHash('sha256').update(buf).digest('hex');

const plainDigest = value => typeof value === 'string' && DIGEST.test(value);
const ownData = (descriptors, key) => {
  const descriptor = descriptors[key];
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw Error('TRUST_CONTEXT');
  return descriptor.value;
};

// Snapshot OWN DATA properties. Never run a caller getter, spread a hostile
// array or coerce a digest to string before validating its primitive type.
function captureExpected(expected) {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(expected)))
    throw Error('TRUST_CONTEXT');
  const fields = Object.getOwnPropertyDescriptors(expected);
  if (Object.values(fields).some(d => !Object.hasOwn(d, 'value')))
    throw Error('TRUST_CONTEXT');
  const get = key => ownData(fields, key);
  const previous = get('priorRevokedEnvelopeDigests');
  if (!Array.isArray(previous) || Object.getPrototypeOf(previous) !== Array.prototype ||
      previous.length > 1024) throw Error('TRUST_CONTEXT');
  const entries = Object.getOwnPropertyDescriptors(previous);
  if (Object.values(entries).some(d => !Object.hasOwn(d, 'value')))
    throw Error('TRUST_CONTEXT');
  const history = [];
  for (let i = 0; i < previous.length; i++) {
    const digest = ownData(entries, String(i));
    if (!plainDigest(digest) || (i && digest <= history[i - 1]))
      throw Error('TRUST_CONTEXT');
    history.push(digest);
  }
  const pinned = Object.freeze({
    repository:get('repository'), environment:get('environment'),
    target:get('target'), issuerKeySha256:get('issuerKeySha256'),
    verifierKeySha256:get('verifierKeySha256'),
    envelopeDigest:get('envelopeDigest'),
    minRevocationSequence:get('minRevocationSequence'),
    minRevocationManifestDigest:get('minRevocationManifestDigest'),
    priorRevokedEnvelopeDigests:Object.freeze(history),
  });
  if (pinned.repository !== REPO || pinned.environment !== ENVIRONMENT ||
      pinned.target !== TARGET || !plainDigest(pinned.issuerKeySha256) ||
      !plainDigest(pinned.verifierKeySha256) || !plainDigest(pinned.envelopeDigest) ||
      pinned.issuerKeySha256 === pinned.verifierKeySha256 ||
      !Number.isSafeInteger(pinned.minRevocationSequence) ||
      pinned.minRevocationSequence < 0 ||
      !plainDigest(pinned.minRevocationManifestDigest)) throw Error('TRUST_CONTEXT');
  return pinned;
}


function publicKey(pem) {
  if (typeof pem !== 'string' || pem.length > 10000 ||
      !/^-----BEGIN PUBLIC KEY-----\r?\n[\s\S]+\r?\n-----END PUBLIC KEY-----\r?\n?$/.test(pem))
    throw Error('TRUST_PUBLIC_KEY');
  const key = createPublicKey(pem);
  if (key.asymmetricKeyType !== 'ed25519') throw Error('TRUST_PUBLIC_KEY');
  return {key, digest:sha256(key.export({type:'spki',format:'der'}))};
}

function signedRevocations(raw, issuerKey) {
  if (typeof raw !== 'string' || raw.length > 65536) throw Error('TRUST_REVOCATIONS');
  const doc = JSON.parse(raw);
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) ||
      typeof doc.payload !== 'string' || doc.payload.length > 60000 ||
      typeof doc.signature !== 'string' || !SIGNATURE.test(doc.signature))
    throw Error('TRUST_REVOCATIONS');
  const decoded = Buffer.from(doc.signature, 'base64');
  if (decoded.length !== 64 || decoded.toString('base64') !== doc.signature ||
      !verify(null, Buffer.from(doc.payload,'utf8'), issuerKey, decoded))
    throw Error('TRUST_REVOCATION_SIGNATURE');
  const manifest = JSON.parse(doc.payload);
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) ||
      JSON.stringify(manifest) !== doc.payload) throw Error('TRUST_REVOCATIONS');
  return {manifest, manifestDigest:sha256(Buffer.from(doc.payload,'utf8'))};
}

/**
 * @param {object} input
 * @param {object} input.expected - MUST originate in protected config/owner issue,
 *   not agent input. issuer/verifier SHA-256 hashes of SPKI DER are independently
 *   pinned, and minRevocationSequence, minRevocationManifestDigest and
 *   priorRevokedEnvelopeDigests come from existing durable Publisher state.
 *   The integrator must durably advance this history under the same effect lock;
 *   it cannot be replaced with a signed list from a PR or a fresh empty array.
 * @param {number} [input.now] - trusted verifier clock, milliseconds since epoch.
 * @param {function} [input.clock] - injected only in focused tests; production
 *   uses Date.now and checks the final snapshot timestamp, not just the start.
 * @param {function} [input.protectedReader] - test injection only; production
 *   uses existing rootOwned (no arbitrary path or network fetches).
 * @returns {Promise<object>} explicit authorized:false diagnostics only.
 */
export async function readProtectedStandingTrustSnapshot({expected, now=Date.now(),
  protectedReader=rootOwned, clock=Date.now} = {}) {
  let pinned;
  try {
    pinned = captureExpected(expected);
    if (!Number.isSafeInteger(now) || now < 0 ||
        typeof protectedReader !== 'function' || typeof clock !== 'function')
      return deny('TRUST_CONTEXT');
  } catch { return deny('TRUST_CONTEXT'); }

  try {
    // Read protected files directly. Re-read after cryptographic validation:
    // concurrent replacement of any file fails closed instead of mixing epochs.
    const issuerPem = await protectedReader(FILES.issuer, 10000);
    const verifierPem = await protectedReader(FILES.verifier, 10000);
    const revocationsRaw = await protectedReader(FILES.revocations, 65536);
    const issuer = publicKey(issuerPem), verifier = publicKey(verifierPem);
    if (issuer.digest !== pinned.issuerKeySha256 ||
        verifier.digest !== pinned.verifierKeySha256 ||
        issuer.digest === verifier.digest) return deny('TRUST_KEY_PROVENANCE');
    const {manifest:m, manifestDigest} = signedRevocations(revocationsRaw, issuer.key);
    if (m.schema !== 'asi.release-envelope-revocations.v1' || m.repository !== REPO ||
        m.environment !== ENVIRONMENT || m.target !== TARGET ||
        m.issuerKeySha256 !== issuer.digest ||
        m.verifierKeySha256 !== verifier.digest)
      return deny('TRUST_REVOCATION_BINDING');
    if (!Number.isSafeInteger(m.sequence) || m.sequence < pinned.minRevocationSequence ||
        !Number.isSafeInteger(m.issuedAt) || !Number.isSafeInteger(m.expiresAt) ||
        m.issuedAt > now || m.expiresAt <= now ||
        m.expiresAt <= m.issuedAt || m.expiresAt - m.issuedAt > 14*DAY)
      return deny('TRUST_REVOCATION_STALE');
    if (!Array.isArray(m.revokedEnvelopeDigests) || m.revokedEnvelopeDigests.length > 1024 ||
        m.revokedEnvelopeDigests.some(d => !plainDigest(d)) ||
        m.revokedEnvelopeDigests.some((d,i) => i && d <= m.revokedEnvelopeDigests[i-1]))
      return deny('TRUST_REVOCATION_FORMAT');
    // Durable history pins the exact last manifest at the same sequence. A
    // later signed manifest must retain every prior revocation: no resurrection
    // through same-sequence equivocation or a newer signed erasure.
    if (m.sequence === pinned.minRevocationSequence &&
        manifestDigest !== pinned.minRevocationManifestDigest)
      return deny('TRUST_REVOCATION_EQUIVOCATION');
    if (pinned.priorRevokedEnvelopeDigests.some(d =>
      !m.revokedEnvelopeDigests.includes(d)))
      return deny('TRUST_REVOCATION_ERASURE');
    if (m.revokedEnvelopeDigests.includes(pinned.envelopeDigest) ||
        pinned.priorRevokedEnvelopeDigests.includes(pinned.envelopeDigest))
      return deny('TRUST_ENVELOPE_REVOKED');
    for (const [name, first, cap] of [
      ['issuer',issuerPem,10000], ['verifier',verifierPem,10000],
      ['revocations',revocationsRaw,65536]]) {
      if (await protectedReader(FILES[name], cap) !== first)
        return deny('TRUST_SNAPSHOT_CHANGED');
    }
    // The expected owner context must still match the original snapshot and
    // the signed revocation record must still be live AFTER all async reads.
    let current;
    try { current = captureExpected(expected); }
    catch { return deny('TRUST_CONTEXT_CHANGED'); }
    if (Object.entries(pinned).some(([k,v]) =>
      k === 'priorRevokedEnvelopeDigests'
        ? v.length !== current[k].length || v.some((d,i) => current[k][i] !== d)
        : current[k] !== v))
      return deny('TRUST_CONTEXT_CHANGED');
    const completedAt = clock();
    if (!Number.isSafeInteger(completedAt) || completedAt < now ||
        completedAt - now > 30000 || completedAt >= m.expiresAt ||
        completedAt < m.issuedAt)
      return deny('TRUST_REVOCATION_STALE');
    return Object.freeze({
      status:'PROTECTED_TRUST_VERIFIED', authorized:false,
      // Public keys only. No private key or authorization token is returned.
      issuerPublicKey:issuerPem, verifierPublicKey:verifierPem,
      issuerKeySha256:issuer.digest, verifierKeySha256:verifier.digest,
      revocationSequence:m.sequence, revocationManifestDigest:manifestDigest,
      observedAt:completedAt, envelopeDigest:pinned.envelopeDigest,
      // Candidate for atomic persistence under the EXISTING Publisher lock.
      // This reader never updates the ledger and never grants authority.
      revocationCheckpoint:Object.freeze({
        sequence:m.sequence, manifestDigest,
        revokedEnvelopeDigests:Object.freeze([...m.revokedEnvelopeDigests]),
      }),
    });
  } catch {
    // Never expose file content, filesystem paths, or cryptographic exceptions.
    return deny('TRUST_SNAPSHOT_UNAVAILABLE');
  }
}
