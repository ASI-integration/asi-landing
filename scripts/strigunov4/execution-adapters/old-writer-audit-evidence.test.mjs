import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectOldWriterUninstallExport} from './old-writer-audit-evidence.mjs';

const expected = Object.freeze({
  actor: 'ASI-integration', actorId: 207600140,
  oldAppSlug: 'asi-engine-publisher-strigunov',
  oldClientId: 'Iv23liIQ2bdtAWva7Qvo',
  oldInstallationId: 174398018,
  newInstallationId: 176281163,
  repository: 'ASI-integration/asi-landing'
});
const entry = () => ({
  action: 'integration_installation.destroy', actor: expected.actor,
  actor_id: expected.actorId, integration: expected.oldAppSlug,
  application_client_id: expected.oldClientId,
  operation_type: 'remove', _document_id: 'p_bgA4dpZNfNvpiLac8eaw',
  request_id: '3E40:C6063:8745ED2:B901172:6AE35CFE',
  created_at: '2026-10-29T14:49:35Z',
  permissions: {contents: 'write', pull_requests: 'write'}
});
const inspect = (rows, context = expected) =>
  inspectOldWriterUninstallExport(JSON.stringify(rows), context);

test('one matching GitHub log event is structural evidence only, never authority', () => {
  const got = inspect([entry()]);
  assert.equal(got.status, 'STRUCTURAL_EVENT_MATCH_ONLY');
  assert.equal(got.eventTime, Date.parse('2026-10-29T14:49:35Z'));
  assert.match(got.exportSha256, /^[a-f0-9]{64}$/);
  assert.equal(got.authorized, false);
  assert.equal(got.authenticatedProvider, false);
  assert.equal(got.installationIdProven, false);
  assert.equal(got.tokensProvenRevoked, false);
  assert(Object.isFrozen(got));
});
test('supports GitHub millisecond exported timestamps without trusting them', () => {
  assert.equal(inspect([{...entry(), created_at: Date.parse('2026-10-29T14:49:35Z')}]).authorized, false);
});
test('supports exact GitHub one-object export shape with millisecond @timestamp', () => {
  const at = Date.parse('2026-10-29T14:49:35Z');
  const record = {...entry(), created_at: at, '@timestamp': at, repository_selection: 'selected'};
  const got = inspectOldWriterUninstallExport(JSON.stringify(record), expected);
  assert.equal(got.eventTime, at);
  assert.equal(got.authorized, false);
});
test('rejects mismatched exported event timestamps', () => {
  const at = Date.parse('2026-10-29T14:49:35Z');
  assert.throws(() => inspect([{...entry(), created_at: at, '@timestamp': at + 1000}]), /AUDIT_EVENT_TIME_MISMATCH/);
});
for (const [name, delta] of [
  ['wrong actor', {actor: 'someone-else'}],
  ['wrong actor ID', {actor_id: 99}],
  ['wrong app', {integration: 'asi-engine-publisher-beget'}],
  ['wrong app client', {application_client_id: 'someone-else'}],
  ['wrong action', {action: 'integration_installation.create'}],
  ['wrong operation', {operation_type: 'add'}],
  ['missing document ID', {_document_id: null}],
  ['missing request ID', {request_id: null}],
  ['untrusted timestamp', {created_at: '29 October 2026'}],
  ['future timestamp', {created_at: '2099-10-29T14:49:35Z'}],
  ['wrong permission shape', {permissions: {contents: 'read', pull_requests: 'write'}}],
]) test('rejects ' + name, () => {
  assert.throws(() => inspect([{...entry(), ...delta}]), /AUDIT_/);
});
test('rejects duplicate matching events', () =>
  assert.throws(() => inspect([entry(), entry()]), /AUDIT_EVENT_MISSING_OR_DUPLICATE/));
test('rejects boxed or incoherent installation identities', () => {
  assert.throws(() => inspect([entry()], {...expected, oldInstallationId: new Number(174398018)}), /AUDIT_CONTEXT/);
  assert.throws(() => inspect([entry()], {...expected, newInstallationId: expected.oldInstallationId}), /AUDIT_CONTEXT/);
});
test('rejects malformed or oversized exports', () => {
  assert.throws(() => inspectOldWriterUninstallExport('{', expected), /AUDIT_EXPORT_JSON/);
  assert.throws(() => inspectOldWriterUninstallExport(' '.repeat(1000001), expected), /AUDIT_EXPORT_BYTES/);
});
test('spoofed owner-approved field never elevates audit-only status', () => {
  const got = inspect([{...entry(), independentlyApproved: true, authorized: true}]);
  assert.equal(got.authorized, false);
  assert.equal(got.authenticatedProvider, false);
});
