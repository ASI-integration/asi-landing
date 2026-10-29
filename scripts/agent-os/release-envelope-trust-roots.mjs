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
 *   pinned, and minRevocationSequence comes from existing durable publisher state.
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
    // Snapshot every protected input BEFORE the first await. Never reread mutable
    // caller data to decide trust. Detect later changes and fail closed instead
    // of returning an inconsistent observation.
    pinned = Object.freeze({
      repository:expected?.repository, environment:expected?.environment,
      target:expected?.target, issuerKeySha256:expected?.issuerKeySha256,
      verifierKeySha256:expected?.verifierKeySha256,
      envelopeDigest:expected?.envelopeDigest,
      minRevocationSequence:expected?.minRevocationSequence,
    });
    if (pinned.repository !== REPO || pinned.environment !== ENVIRONMENT ||
        pinned.target !== TARGET || !DIGEST.test(pinned.issuerKeySha256 || '') ||
        !DIGEST.test(pinned.verifierKeySha256 || '') ||
        !DIGEST.test(pinned.envelopeDigest || '') ||
        pinned.issuerKeySha256 === pinned.verifierKeySha256 ||
        !Number.isSafeInteger(pinned.minRevocationSequence) ||
        pinned.minRevocationSequence < 0 ||
        !Number.isSafeInteger(now) || now < 0 ||
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
        m.revokedEnvelopeDigests.some(d => !DIGEST.test(d)) ||
        m.revokedEnvelopeDigests.some((d,i) => i && d <= m.revokedEnvelopeDigests[i-1]))
      return deny('TRUST_REVOCATION_FORMAT');
    if (m.revokedEnvelopeDigests.includes(pinned.envelopeDigest))
      return deny('TRUST_ENVELOPE_REVOKED');
    for (const [name, first, cap] of [
      ['issuer',issuerPem,10000], ['verifier',verifierPem,10000],
      ['revocations',revocationsRaw,65536]]) {
      if (await protectedReader(FILES[name], cap) !== first)
        return deny('TRUST_SNAPSHOT_CHANGED');
    }
    // The expected owner context must still match the original snapshot and
    // the signed revocation record must still be live AFTER all async reads.
    if (Object.entries(pinned).some(([k,v]) => expected[k] !== v))
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
    });
  } catch {
    // Never expose file content, filesystem paths, or cryptographic exceptions.
    return deny('TRUST_SNAPSHOT_UNAVAILABLE');
  }
}
