import { validateAcceptancePlan, validateAcceptanceResult } from './contracts.mjs';

const PLAN_MARKER = 'ACCEPTANCE_PLAN_EVIDENCE:';
const RESULT_MARKER = 'ACCEPTANCE_RESULT_EVIDENCE:';

export function buildAcceptancePlan({
  runnerId,
  environment,
  identity,
  noExternalActions,
  externalActionsJustification = null,
  isolated,
  namespace = null,
  cleanupRequired,
  cleanupStrategy,
  ownerGateRequired = false,
}) {
  const plan = {
    schemaVersion: 'asi.agent-os.acceptance-plan.v1',
    runnerId,
    target: { environment, identity },
    safety: { noExternalActions, externalActionsJustification },
    fixtureOwnership: { isolated, namespace },
    cleanup: { required: cleanupRequired, strategy: cleanupStrategy },
    generatedAt: new Date().toISOString(),
    ownerGateRequired,
  };
  return validateAcceptancePlan(plan);
}

export function buildAcceptanceResult({
  runnerId,
  planRef,
  environment,
  identity,
  status,
  noExternalActions,
  productionMutation,
  cleanupPerformed,
  verifyZeroResidue = null,
  evidence = [],
}) {
  const result = {
    schemaVersion: 'asi.agent-os.acceptance-result.v1',
    runnerId,
    planRef,
    target: { environment, identity },
    status,
    safety: { noExternalActions, productionMutation },
    cleanup: { performed: cleanupPerformed, verifyZeroResidue },
    evidence,
    generatedAt: new Date().toISOString(),
  };
  return validateAcceptanceResult(result);
}

export function emitAcceptancePlan(plan) {
  process.stdout.write(`${PLAN_MARKER}${JSON.stringify(plan)}\n`);
  return plan;
}

export function emitAcceptanceResult(result) {
  process.stdout.write(`${RESULT_MARKER}${JSON.stringify(result)}\n`);
  return result;
}

export function parseEmittedEvidence(output) {
  const plan = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith(PLAN_MARKER))
    .map((line) => JSON.parse(line.slice(PLAN_MARKER.length)))
    .at(-1);
  const result = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith(RESULT_MARKER))
    .map((line) => JSON.parse(line.slice(RESULT_MARKER.length)))
    .at(-1);
  return { plan, result };
}
