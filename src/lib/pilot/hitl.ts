/**
 * Safe owner/HITL view for /pilot.
 * Continue is fail-closed: only explicitly classified / allowlisted safe
 * docs/pilot gates may be continued. Unknown, unclassified, or privileged
 * gates never become approvable from free-text wording.
 */
import type { RuntimeBridgeOwnerGateView } from '@/lib/asi-runtime/bridge-types';
import { containsForbiddenStringContent } from '@/lib/asi-runtime/ingest-schema';
import { PILOT_USER_STATE, sanitizePilotUserText } from './user-copy';

export type PilotHitlView = {
  required: true;
  questionRu: string;
  reasonRu: string | null;
  canContinue: boolean;
  gateId: string;
  taskCycle: string;
};

/** Structured Agent OS / Runtime red-action IDs. Exact match only — not a free-text scan. */
const PRIVILEGED_OWNER_GATE_ACTIONS = new Set([
  'merge',
  'deploy',
  'release_source_change',
  'production_deploy',
  'production_rollback',
  'production_migration',
  'production_data_mutation',
  'secret_value_access',
  'dns_or_tls_change',
  'payment_or_financial_operation',
  'real_external_message_or_provider_call',
  'approved_ux_or_public_copy_change',
  'location_scoring_or_public_contract_change',
  'repository_or_environment_settings_change',
  'production_backup_access',
  'published_branch_rewrite',
  'broad_test_suite',
]);

/** Deterministic safe docs/pilot HITL actions. */
const PILOT_SAFE_OWNER_GATE_ACTIONS = new Set([
  'pilot_docs_update',
  'Продолжить правку документации',
]);

const PILOT_SAFE_OWNER_GATE_SIDE_EFFECTS = new Set([
  'update the same task only',
]);

const PILOT_DOCS_TARGET = /^docs\/pilot\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

function isPilotDocsExactTarget(target: string): boolean {
  return PILOT_DOCS_TARGET.test(target) && !target.includes('..') && !target.includes('\\');
}

export function isExplicitPrivilegedPilotOwnerGate(
  gate: Pick<RuntimeBridgeOwnerGateView, 'action' | 'classification'>,
): boolean {
  if (gate.classification === 'privileged') return true;
  return PRIVILEGED_OWNER_GATE_ACTIONS.has(gate.action);
}

function hasSafePilotClassification(
  gate: Pick<RuntimeBridgeOwnerGateView, 'classification'>,
): boolean {
  if (gate.classification == null || gate.classification === '') return true;
  return gate.classification === 'pilot_docs_green';
}

/**
 * Allowlisted safe /pilot continue. Unknown/unclassified/privileged => false.
 */
export function canContinuePilotOwnerGate(
  gate: Pick<
    RuntimeBridgeOwnerGateView,
    'action' | 'allowedSideEffect' | 'exactTarget' | 'classification'
  >,
): boolean {
  if (isExplicitPrivilegedPilotOwnerGate(gate)) return false;
  if (!hasSafePilotClassification(gate)) return false;
  if (!PILOT_SAFE_OWNER_GATE_ACTIONS.has(gate.action)) return false;
  if (!PILOT_SAFE_OWNER_GATE_SIDE_EFFECTS.has(gate.allowedSideEffect)) return false;
  if (!isPilotDocsExactTarget(gate.exactTarget)) return false;
  return true;
}

function safeGateText(value: unknown): string | null {
  const sanitized = sanitizePilotUserText(value);
  if (!sanitized) return null;
  if (containsForbiddenStringContent(sanitized)) return null;
  return sanitized;
}

/**
 * Map a pending owner gate into a pilot-safe HITL prompt.
 * Only allowlisted safe docs/pilot gates expose continue.
 */
export function buildPilotHitlView(
  gate: RuntimeBridgeOwnerGateView | null | undefined,
): PilotHitlView | null {
  if (!gate || gate.status !== 'pending') return null;
  if (!gate.gateId || !gate.taskCycle) return null;

  const reasonRu = safeGateText(gate.reason);
  const questionRu = reasonRu
    || safeGateText(gate.action)
    || PILOT_USER_STATE.needsAnswer;

  return {
    required: true,
    questionRu,
    reasonRu: reasonRu && reasonRu !== questionRu ? reasonRu : reasonRu,
    canContinue: canContinuePilotOwnerGate(gate),
    gateId: gate.gateId,
    taskCycle: gate.taskCycle,
  };
}
