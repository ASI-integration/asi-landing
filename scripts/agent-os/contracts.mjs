import fs from 'node:fs';
import path from 'node:path';

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function loadChangeMap(repoRoot) {
  const map = readJson(path.join(repoRoot, 'docs/agent-os/change-to-test-map.json'));
  invariant(map.schemaVersion === 'asi.agent-os.change-to-test-map.v1', 'Unexpected change-to-test map version');
  invariant(Array.isArray(map.rules) && map.rules.length > 0, 'Change-to-test map has no rules');
  return map;
}

export function selectChecks(paths, map) {
  const matchedRules = map.rules.filter((rule) =>
    paths.some((changedPath) => rule.prefixes.some((prefix) => changedPath.startsWith(prefix))),
  );
  const checks = new Set(matchedRules.flatMap((rule) => rule.checks));
  if (matchedRules.length === 0) map.default.checks.forEach((check) => checks.add(check));
  return {
    checks: [...checks],
    protectedPaths: paths.filter((changedPath) =>
      matchedRules.some((rule) => rule.protected && rule.prefixes.some((prefix) => changedPath.startsWith(prefix))),
    ),
    redActions: [...new Set(matchedRules.flatMap((rule) => rule.redActions ?? []))],
    matchedRuleIds: matchedRules.map((rule) => rule.id),
  };
}

export function validateTaskPreflight(value) {
  invariant(value.schemaVersion === 'asi.agent-os.task-preflight.v1', 'Invalid task preflight schemaVersion');
  invariant(/^[0-9a-f]{40}$/.test(value.repository?.baselineSha ?? ''), 'baselineSha must be a full SHA');
  invariant(['green', 'yellow', 'red'].includes(value.classification), 'Invalid classification');
  invariant(Array.isArray(value.changeSet?.forbiddenPaths) && value.changeSet.forbiddenPaths.length === 0, 'Forbidden paths present');
  invariant(value.safety?.noProductionWrites === true, 'Production writes must be disabled');
  invariant(value.safety?.secretsAccessed === false, 'Secret access must be false');
  invariant(value.validation?.broadSuiteRequired === false, 'Broad suite requires a separate red gate');
  if (value.classification === 'red') {
    invariant(value.redActions.length > 0, 'Red preflight requires at least one red action');
    invariant(value.ownerGate?.required === true, 'Red preflight requires owner gate');
    invariant(['AWAITING_OWNER', 'BLOCKED'].includes(value.status), 'Red preflight cannot be READY');
  }
  return value;
}

export function validateTaskResult(value) {
  invariant(value.schemaVersion === 'asi.agent-os.task-result.v1', 'Invalid task result schemaVersion');
  invariant(['DONE', 'PARTIAL', 'BLOCKED', 'AWAITING_OWNER'].includes(value.status), 'Invalid task result status');
  invariant(value.sideEffects?.production === false, 'Production side effect must be false');
  invariant(value.sideEffects?.secrets === false, 'Secret side effect must be false');
  invariant(value.sideEffects?.dns === false, 'DNS side effect must be false');
  invariant(value.sideEffects?.payments === false, 'Payment side effect must be false');
  invariant(value.sideEffects?.realMessages === false, 'Real-message side effect must be false');
  return value;
}

export function validateOwnerGate(value) {
  invariant(value.schemaVersion === 'asi.agent-os.owner-gate.v1', 'Invalid owner gate schemaVersion');
  invariant(value.typedConfirmation?.countsAsOwnerApproval === false, 'Typed confirmation must never count as owner approval');
  if (value.status === 'approved') {
    invariant(value.authorization?.source === 'explicit_owner_message', 'Approved gate requires explicit owner message');
    invariant(value.authorization?.owner === 'Nikolay', 'Approved gate requires Nikolay');
  } else {
    invariant(value.authorization === null, 'Non-approved gate cannot carry authorization');
  }
  return value;
}

export function validateStagingFixture(value) {
  invariant(value.schemaVersion === 'asi.agent-os.staging-fixture.v1', 'Invalid staging fixture schemaVersion');
  invariant(value.environment === 'staging' && value.isolated === true, 'Fixture must be isolated staging only');
  invariant(value.cleanup?.required === true && value.cleanup?.verifyZeroResidue === true, 'Fixture cleanup must be mandatory');
  invariant(value.safety?.noExternalActions === true, 'External actions must be disabled');
  invariant(value.safety?.productionCredentials === false, 'Production credentials must be absent');
  return value;
}

export function validateProductionPreflight(value) {
  invariant(value.schemaVersion === 'asi.agent-os.production-preflight.v1', 'Invalid production preflight schemaVersion');
  invariant(value.mode === 'read-only-preflight', 'Production mode must be read-only-preflight');
  invariant(value.dispatchAllowed === false, 'Production dispatch must be disabled');
  invariant(value.mutationAllowed === false, 'Production mutation must be disabled');
  invariant(value.secretValuesAllowed === false, 'Secret values must be disabled');
  return value;
}

export function validateContractBundle(repoRoot) {
  const schemaDir = path.join(repoRoot, 'docs/agent-os/schemas');
  const schemas = fs.readdirSync(schemaDir).filter((name) => name.endsWith('.schema.json'));
  invariant(schemas.length === 5, `Expected 5 schemas, found ${schemas.length}`);
  for (const name of schemas) {
    const schema = readJson(path.join(schemaDir, name));
    invariant(schema.$schema === 'https://json-schema.org/draft/2020-12/schema', `${name}: wrong JSON Schema draft`);
    invariant(schema.type === 'object', `${name}: root must be object`);
  }

  loadChangeMap(repoRoot);
  const fixtures = path.join(repoRoot, 'docs/agent-os/fixtures');
  validateTaskPreflight(readJson(path.join(fixtures, 'docs-only-preflight.json')));
  validateTaskResult(readJson(path.join(fixtures, 'docs-only-result.json')));
  validateOwnerGate(readJson(path.join(fixtures, 'typed-confirmation-only-owner-gate.json')));
  validateStagingFixture(readJson(path.join(fixtures, 'isolated-staging-fixture.json')));
  validateProductionPreflight(readJson(path.join(fixtures, 'production-read-only-preflight.json')));
  return { schemas: schemas.length, fixtures: 5 };
}
