import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const validatorCache = new Map();

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function schemaError(name, errors) {
  const details = (errors ?? [])
    .map((error) => `${error.instancePath || '/'} ${error.message}`)
    .join('; ');
  return `${name} failed Draft 2020-12 validation: ${details || 'unknown schema error'}`;
}

function contractValidators(repoRoot = DEFAULT_REPO_ROOT) {
  const resolvedRoot = path.resolve(repoRoot);
  if (validatorCache.has(resolvedRoot)) return validatorCache.get(resolvedRoot);

  const schemaDir = path.join(resolvedRoot, 'docs/agent-os/schemas');
  const schemaFiles = fs.readdirSync(schemaDir).filter((name) => name.endsWith('.schema.json')).sort();
  invariant(schemaFiles.length === 5, `Expected 5 schemas, found ${schemaFiles.length}`);

  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const schemas = schemaFiles.map((name) => ({ name, schema: readJson(path.join(schemaDir, name)) }));
  for (const { name, schema } of schemas) {
    invariant(schema.$schema === 'https://json-schema.org/draft/2020-12/schema', `${name}: wrong JSON Schema draft`);
    invariant(ajv.validateSchema(schema), schemaError(name, ajv.errors));
    ajv.addSchema(schema);
  }

  const validators = new Map();
  for (const { name, schema } of schemas) {
    const validate = ajv.getSchema(schema.$id);
    invariant(validate, `${name}: schema did not compile`);
    validators.set(name, validate);
  }
  const bundle = { ajv, schemaFiles, validators };
  validatorCache.set(resolvedRoot, bundle);
  return bundle;
}

export function validateArtifact(schemaName, value, repoRoot = DEFAULT_REPO_ROOT) {
  const fileName = schemaName.endsWith('.schema.json') ? schemaName : `${schemaName}.schema.json`;
  const validate = contractValidators(repoRoot).validators.get(fileName);
  invariant(validate, `Unknown contract schema: ${fileName}`);
  invariant(validate(value), schemaError(fileName, validate.errors));
  return value;
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

export function validateTaskPreflight(value, repoRoot = DEFAULT_REPO_ROOT) {
  validateArtifact('task-preflight', value, repoRoot);
  invariant(value.safety.noProductionWrites === true, 'Production writes must be disabled');
  invariant(value.safety.secretsAccessed === false, 'Secret access must be false');
  invariant(value.validation.broadSuiteRequired === false, 'Broad suite requires a separate red gate');
  if (value.status !== 'BLOCKED') {
    invariant(value.changeSet.forbiddenPaths.length === 0, 'Forbidden paths present');
  }
  if (value.classification === 'red') {
    invariant(value.redActions.length > 0, 'Red preflight requires at least one red action');
    invariant(value.ownerGate.required === true, 'Red preflight requires owner gate');
    invariant(['AWAITING_OWNER', 'BLOCKED'].includes(value.status), 'Red preflight cannot be READY');
  }
  return value;
}

export function validateTaskResult(value, repoRoot = DEFAULT_REPO_ROOT) {
  validateArtifact('task-result', value, repoRoot);
  invariant(value.sideEffects.production === false, 'Production side effect must be false');
  invariant(value.sideEffects.secrets === false, 'Secret side effect must be false');
  invariant(value.sideEffects.dns === false, 'DNS side effect must be false');
  invariant(value.sideEffects.payments === false, 'Payment side effect must be false');
  invariant(value.sideEffects.realMessages === false, 'Real-message side effect must be false');
  return value;
}

function exactJson(value) {
  if (Array.isArray(value)) return `[${value.map(exactJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${exactJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function validateOwnerGate(value, expected = null, repoRoot = DEFAULT_REPO_ROOT) {
  validateArtifact('owner-gate', value, repoRoot);
  invariant(value.typedConfirmation.countsAsOwnerApproval === false, 'Typed confirmation must never count as owner approval');
  if (value.status === 'approved') {
    invariant(value.authorization.source === 'explicit_owner_message', 'Approved gate requires explicit owner message');
    invariant(value.authorization.owner === 'Nikolay', 'Approved gate requires Nikolay');
    invariant(expected, 'Approved gate requires an expected runtime contract');
  } else {
    invariant(value.authorization === null, 'Non-approved gate cannot carry authorization');
  }

  if (expected) {
    invariant(value.status === 'approved', `Owner gate status ${value.status} cannot authorize action`);
    invariant(value.taskId === expected.taskId, 'Owner gate task mismatch');
    invariant(value.action === expected.action, 'Owner gate action mismatch');
    invariant(value.target === expected.target, 'Owner gate target mismatch');
    invariant(exactJson(value.identity) === exactJson(expected.identity), 'Owner gate identity mismatch');
    invariant(value.allowedSideEffect === expected.allowedSideEffect, 'Owner gate allowed side effect mismatch');
    invariant(exactJson(value.postActionVerification) === exactJson(expected.postActionVerification), 'Owner gate post-action verification mismatch');
    invariant(value.authorization.scope === expected.scope, 'Owner gate authorization scope mismatch');
    invariant(value.authorization.taskCycle === expected.taskCycle, 'Owner gate task cycle mismatch');
  }
  return value;
}

export function validateStagingFixture(value, repoRoot = DEFAULT_REPO_ROOT) {
  validateArtifact('staging-fixture', value, repoRoot);
  invariant(value.environment === 'staging' && value.isolated === true, 'Fixture must be isolated staging only');
  invariant(value.cleanup.required === true && value.cleanup.verifyZeroResidue === true, 'Fixture cleanup must be mandatory');
  invariant(value.safety.noExternalActions === true, 'External actions must be disabled');
  invariant(value.safety.productionCredentials === false, 'Production credentials must be absent');
  return value;
}

export function validateProductionPreflight(value, repoRoot = DEFAULT_REPO_ROOT) {
  validateArtifact('production-preflight', value, repoRoot);
  invariant(value.mode === 'read-only-preflight', 'Production mode must be read-only-preflight');
  invariant(value.dispatchAllowed === false, 'Production dispatch must be disabled');
  invariant(value.mutationAllowed === false, 'Production mutation must be disabled');
  invariant(value.secretValuesAllowed === false, 'Secret values must be disabled');
  return value;
}

function uniqueStrings(values) {
  return [...new Set((values ?? []).filter((value) => typeof value === 'string' && value.length > 0))];
}

function safeTask(task = {}) {
  const arrayOrFallback = (value, fallback) => uniqueStrings(value).length > 0 ? uniqueStrings(value) : [fallback];
  return {
    id: typeof task.id === 'string' && task.id ? task.id : 'unknown-task',
    title: typeof task.title === 'string' && task.title ? task.title : 'Blocked task preflight',
    objective: typeof task.objective === 'string' && task.objective ? task.objective : 'Return a safe blocked artifact.',
    acceptanceCriteria: arrayOrFallback(task.acceptanceCriteria, 'Resolve the reported preflight blocker.'),
    inScope: arrayOrFallback(task.inScope, 'Local preflight only'),
    outOfScope: arrayOrFallback(task.outOfScope, 'All external side effects'),
  };
}

export function buildTaskPreflight({ input, repository, paths, map }) {
  const changedPaths = uniqueStrings(paths).sort();
  const forbiddenPaths = changedPaths.filter((changedPath) => changedPath === 'tmp' || changedPath.startsWith('tmp/'));
  const selected = selectChecks(changedPaths, map);
  const redActions = uniqueStrings([...(input.redActions ?? []), ...selected.redActions]);
  const classification = redActions.length > 0 ? 'red' : input.classification;
  const red = classification === 'red';
  const status = forbiddenPaths.length > 0 ? 'BLOCKED' : red ? 'AWAITING_OWNER' : 'READY';
  const preflight = {
    schemaVersion: 'asi.agent-os.task-preflight.v1',
    task: input.task,
    repository,
    classification,
    redActions,
    ownerGate: { required: red, status: red ? 'missing' : 'not_required' },
    changeSet: { paths: changedPaths, protectedPaths: selected.protectedPaths, forbiddenPaths },
    validation: {
      checks: selected.checks,
      focusedTests: input.focusedTests ?? [],
      broadSuiteRequired: false,
    },
    safety: { noProductionWrites: true, noExternalActions: true, secretsAccessed: false },
    status,
    blockers: forbiddenPaths.length > 0 ? [`Forbidden paths present: ${forbiddenPaths.join(', ')}`] : [],
  };
  validateTaskPreflight(preflight);
  return { matchedRuleIds: selected.matchedRuleIds, preflight };
}

export function buildBlockedTaskPreflight({ input = {}, repository = {}, paths = [], map, reason }) {
  const changedPaths = uniqueStrings(paths).sort();
  const selected = map ? selectChecks(changedPaths, map) : {
    checks: ['preflight-contract-validation'], protectedPaths: [], redActions: [], matchedRuleIds: [],
  };
  const redActions = selected.redActions;
  const red = redActions.length > 0;
  const preflight = {
    schemaVersion: 'asi.agent-os.task-preflight.v1',
    task: safeTask(input.task),
    repository: {
      name: 'ASI-integration/asi-landing',
      baselineSha: /^[0-9a-f]{40}$/.test(repository.baselineSha ?? '') ? repository.baselineSha : '0000000000000000000000000000000000000000',
      headRef: typeof repository.headRef === 'string' && repository.headRef ? repository.headRef : 'unknown-head',
    },
    classification: red ? 'red' : ['green', 'yellow'].includes(input.classification) ? input.classification : 'yellow',
    redActions,
    ownerGate: { required: red, status: red ? 'missing' : 'not_required' },
    changeSet: {
      paths: changedPaths,
      protectedPaths: selected.protectedPaths,
      forbiddenPaths: changedPaths.filter((changedPath) => changedPath === 'tmp' || changedPath.startsWith('tmp/')),
    },
    validation: { checks: selected.checks, focusedTests: [], broadSuiteRequired: false },
    safety: { noProductionWrites: true, noExternalActions: true, secretsAccessed: false },
    status: 'BLOCKED',
    blockers: [typeof reason === 'string' && reason ? reason : 'Preflight validation failed.'],
  };
  validateTaskPreflight(preflight);
  return { matchedRuleIds: selected.matchedRuleIds, preflight };
}

export function validateContractBundle(repoRoot) {
  const { schemaFiles } = contractValidators(repoRoot);
  const fixtures = path.join(repoRoot, 'docs/agent-os/fixtures');
  validateTaskPreflight(readJson(path.join(fixtures, 'docs-only-preflight.json')), repoRoot);
  validateTaskResult(readJson(path.join(fixtures, 'docs-only-result.json')), repoRoot);
  validateOwnerGate(readJson(path.join(fixtures, 'typed-confirmation-only-owner-gate.json')), null, repoRoot);
  validateStagingFixture(readJson(path.join(fixtures, 'isolated-staging-fixture.json')), repoRoot);
  validateProductionPreflight(readJson(path.join(fixtures, 'production-read-only-preflight.json')), repoRoot);
  return { schemas: schemaFiles.length, fixtures: 5 };
}
