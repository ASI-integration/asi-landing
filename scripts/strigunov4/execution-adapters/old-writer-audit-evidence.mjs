import {createHash} from 'node:crypto';

// Structural consistency only: an exported security log is not provider authentication.
const fail = (code) => { throw new Error(code); };
const sha256 = (raw) => createHash('sha256').update(raw).digest('hex');
const own = (o, k) => o && typeof o === 'object' &&
  Object.getOwnPropertyDescriptor(o, k)?.value;
const text = (v) => typeof v === 'string' && v.length > 0 && v.length < 256;
const number = (v) => Number.isSafeInteger(v) && v > 0;
const timestamp = (v) => {
  if (Number.isSafeInteger(v) && v > 0) return v;
  if (typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(v))
    return Date.parse(v);
  return NaN;
};

/**
 * Inspect, but never authorize from, a GitHub personal security-log JSON export.
 * A separate, trusted operator must authenticate its origin and repository scope.
 */
export function inspectOldWriterUninstallExport(raw, expected) {
  if (!(typeof raw === 'string' || Buffer.isBuffer(raw)) ||
      Buffer.byteLength(raw) > 1_000_000) fail('AUDIT_EXPORT_BYTES');
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  let events;
  try { events = JSON.parse(bytes.toString('utf8')); }
  catch { fail('AUDIT_EXPORT_JSON'); }
  const entries = Array.isArray(events) ? events :
    events && typeof events === 'object' ? [events] : null;
  if (!entries || entries.length > 500) fail('AUDIT_EXPORT_ARRAY');
  if (!expected || !text(expected.actor) || !number(expected.actorId) ||
      !text(expected.oldAppSlug) || !text(expected.oldClientId) ||
      !text(expected.repository) || !number(expected.oldInstallationId) ||
      !number(expected.newInstallationId) ||
      expected.oldInstallationId === expected.newInstallationId) fail('AUDIT_CONTEXT');
  const matching = entries.filter((e) => own(e, 'action') === 'integration_installation.destroy' &&
    own(e, 'actor') === expected.actor &&
    own(e, 'actor_id') === expected.actorId &&
    own(e, 'integration') === expected.oldAppSlug &&
    own(e, 'application_client_id') === expected.oldClientId &&
    own(e, 'operation_type') === 'remove');
  if (matching.length !== 1) fail('AUDIT_EVENT_MISSING_OR_DUPLICATE');
  const e = matching[0];
  const id = own(e, '_document_id'), requestId = own(e, 'request_id');
  const at = timestamp(own(e, 'created_at'));
  if (!text(id) || !text(requestId) || !Number.isSafeInteger(at) ||
      at <= 0 || at > Date.now() + 300_000) fail('AUDIT_EVENT_INCOMPLETE');
  if (own(e, '@timestamp') !== undefined && timestamp(own(e, '@timestamp')) !== at)
    fail('AUDIT_EVENT_TIME_MISMATCH');
  if (own(e, 'repository_selection') !== undefined && own(e, 'repository_selection') !== 'selected')
    fail('AUDIT_REPO_SELECTION');
  const permissions = own(e, 'permissions');
  if (permissions && (typeof permissions !== 'object' || Array.isArray(permissions) ||
      permissions.contents !== 'write' || permissions.pull_requests !== 'write'))
    fail('AUDIT_WRITE_SCOPE');
  // GitHub's personal-log export does not bind this event to numeric installation ID.
  // No token-expiry or credential-revocation claim can follow from the export alone.
  return Object.freeze({
    status: 'STRUCTURAL_EVENT_MATCH_ONLY',
    eventId: id, requestId, eventTime: at,
    exportSha256: sha256(bytes),
    repository: expected.repository,
    oldInstallationId: expected.oldInstallationId,
    authorized: false, authenticatedProvider: false,
    installationIdProven: false, tokensProvenRevoked: false
  });
}
